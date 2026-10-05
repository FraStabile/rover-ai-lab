import {
  MSG_TYPES,
  TOPICS,
  type AggregatedState,
  type AiExchange,
  type AiInspectorData,
  type AiLinkStatus,
  type AppConfig,
  type ControlMode,
  type Decision,
  type DecisionErrorCode,
  type DecisionResult,
  type ModelInfo,
  type RobotTransport,
  type Twist,
} from '@rover/protocol';
import type { DecisionEngine } from '@rover/decision-engine';
import type { EventLogger } from '@rover/logging';
import { RateMeter, Rng, round } from '@rover/shared';
import { StateAggregator } from './aggregator';
import { LocalPlanner } from './planner';
import { SafetyController, type SafetyDecision, type VelocityCommand } from './safety';

export interface AutonomyStackOptions {
  transport: RobotTransport;
  logger: EventLogger;
  config: () => AppConfig;
  engine: DecisionEngine;
}

interface PendingResult {
  result: DecisionResult;
  requestSimTime: number;
  applyAt: number;
  injectedLatencyMs: number;
  state: AggregatedState;
  id: number;
}

const MANUAL_DEADMAN_MS = 600;

/**
 * The autonomy pipeline:
 *   topics → StateAggregator → DecisionEngine (rate-limited, async) → SafetyController → LocalPlanner → /cmd_vel
 *
 * The decision engine runs at its own rate, independent of the simulation tick.
 * The safety layer runs at every control tick, on the latest state, regardless of the AI.
 */
export class AutonomyStack {
  readonly aggregator: StateAggregator;
  readonly safety: SafetyController;
  readonly planner: LocalPlanner;
  mode: ControlMode = 'MANUAL';
  estop = false;

  lastState: AggregatedState | null = null;
  currentDecision: Decision | null = null;
  lastVerdict: SafetyDecision | null = null;
  lastCmd: VelocityCommand = { linear: 0, angular: 0 };
  lastError: DecisionErrorCode | null = null;
  lastLatencyMs: number | null = null;
  linkStatus: AiLinkStatus = 'UNKNOWN';
  healthOk: boolean | null = null;

  private engine: DecisionEngine;
  private readonly transport: RobotTransport;
  private readonly logger: EventLogger;
  private readonly config: () => AppConfig;
  private nextControlAt = 0;
  private nextDecisionAt = 0;
  private lastDecisionSimTime = -Infinity;
  private autoSince = 0;
  private inflight: Promise<void> | null = null;
  private pending: PendingResult | null = null;
  private generation = 0;
  private requestId = 0;
  private manual = { throttle: 0, steering: 0, wall: 0 };
  private history: AiExchange[] = [];
  private lastExchange: AiExchange | null = null;
  private decisionMeter = new RateMeter(5);
  private latencyRng: Rng;
  private lastVerdictKey = '';
  private lastSafetyPublish = -Infinity;
  aiTicks = 0;
  /** Hook for the run recorder. */
  onExchange: ((ex: AiExchange) => void) | null = null;

  constructor(opts: AutonomyStackOptions) {
    this.transport = opts.transport;
    this.logger = opts.logger;
    this.config = opts.config;
    this.engine = opts.engine;
    this.aggregator = new StateAggregator(this.transport, this.config);
    this.safety = new SafetyController(
      () => this.config().safety,
      () => this.config().robot,
    );
    this.planner = new LocalPlanner(
      () => this.config().planner,
      () => this.config().robot,
      () => this.config().safety,
    );
    this.latencyRng = Rng.derive(this.config().simulation.seed, 'ai-latency');
    const t = this.transport;
    t.advertise(TOPICS.cmdVel, MSG_TYPES.Twist, '/local_planner', this.config().planner.controlFrequency);
    t.advertise(TOPICS.decision, MSG_TYPES.Decision, '/decision_engine', 0);
    t.advertise(TOPICS.safety, MSG_TYPES.SafetyStatus, '/safety_controller', 2);
    t.advertise(TOPICS.roverState, MSG_TYPES.RoverState, '/state_aggregator', 0);
    this.linkStatus = this.engine.id === 'mock' ? 'MOCK' : 'UNKNOWN';
  }

  get engineId(): string {
    return this.engine.id;
  }

  get inFlight(): boolean {
    return this.inflight !== null || this.pending !== null;
  }

  getModelInfo(): ModelInfo {
    try {
      return this.engine.getModelInfo();
    } catch {
      return { provider: this.engine.id, model: 'unknown' };
    }
  }

  getEngine(): DecisionEngine {
    return this.engine;
  }

  setEngine(engine: DecisionEngine): void {
    this.engine = engine;
    this.generation++;
    this.inflight = null;
    this.pending = null;
    this.currentDecision = null;
    this.lastError = null;
    this.lastDecisionSimTime = -Infinity;
    this.linkStatus = engine.id === 'mock' ? 'MOCK' : 'UNKNOWN';
    this.healthOk = null;
    this.logger.info('MODE_CHANGED', 'AutonomyStack', `Decision engine set to ${engine.id}`);
  }

  setMode(mode: ControlMode, simTime: number): void {
    if (mode === this.mode) return;
    this.mode = mode;
    this.generation++;
    this.inflight = null;
    this.pending = null;
    this.currentDecision = null;
    this.lastError = null;
    this.lastDecisionSimTime = -Infinity;
    this.autoSince = simTime;
    this.nextDecisionAt = simTime;
    this.manual = { throttle: 0, steering: 0, wall: 0 };
    this.logger.info('MODE_CHANGED', 'AutonomyStack', `Control mode: ${mode}`);
  }

  setEstop(engaged: boolean): void {
    if (engaged === this.estop) return;
    this.estop = engaged;
    this.logger.log({ type: engaged ? 'SAFETY_BLOCK' : 'SAFETY_ALLOW', source: 'SafetyController', message: engaged ? 'EMERGENCY STOP engaged by operator' : 'Emergency stop released', level: engaged ? 'warn' : 'info' });
  }

  setManual(throttle: number, steering: number): void {
    const c = (v: number) => (Number.isFinite(v) ? Math.max(-1, Math.min(1, v)) : 0);
    this.manual = { throttle: c(throttle), steering: c(steering), wall: Date.now() };
  }

  setHealth(ok: boolean, message: string): void {
    const prev = this.healthOk;
    this.healthOk = ok;
    if (this.engine.id === 'mock') {
      this.linkStatus = 'MOCK';
      return;
    }
    if (!ok) this.linkStatus = 'OFFLINE';
    else if (this.linkStatus === 'OFFLINE' || this.linkStatus === 'UNKNOWN') this.linkStatus = 'CONNECTED';
    if (prev !== ok) this.logger.log({ type: ok ? 'AI_RESPONSE' : 'AI_ERROR', source: this.engine.id, message: ok ? `AI link up: ${message}` : `AI OFFLINE: ${message}`, level: ok ? 'info' : 'warn' });
  }

  reset(): void {
    this.generation++;
    this.inflight = null;
    this.pending = null;
    this.currentDecision = null;
    this.lastVerdict = null;
    this.lastCmd = { linear: 0, angular: 0 };
    this.lastError = null;
    this.lastLatencyMs = null;
    this.lastDecisionSimTime = -Infinity;
    this.nextControlAt = 0;
    this.nextDecisionAt = 0;
    this.autoSince = 0;
    this.history = [];
    this.lastExchange = null;
    this.decisionMeter.reset();
    this.latencyRng = Rng.derive(this.config().simulation.seed, 'ai-latency');
    this.lastVerdictKey = '';
    this.lastSafetyPublish = -Infinity;
    this.aiTicks = 0;
    this.requestId = 0;
    this.aggregator.reset();
    this.engine.reset?.();
  }

  /** Called on every simulation tick (after sensors have published). */
  async tick(simTime: number): Promise<void> {
    const cfg = this.config();
    if (simTime + 1e-9 < this.nextControlAt) return;
    const period = 1 / Math.max(1, cfg.planner.controlFrequency);
    this.nextControlAt = this.nextControlAt + period < simTime ? simTime + period : this.nextControlAt + period;

    const state = this.aggregator.build(simTime);
    this.lastState = state;

    let verdict: SafetyDecision;
    let planned: VelocityCommand;
    let freshDecision = false;

    if (this.mode === 'AUTO') {
      if (!this.inflight && !this.pending && simTime + 1e-9 >= this.nextDecisionAt) {
        this.nextDecisionAt = simTime + cfg.ai.decisionIntervalMs / 1000;
        this.launchRequest(state, simTime);
      }
      if (this.inflight && (cfg.ai.syncMode === 'lockstep' || this.engine.deterministic)) await this.inflight;
      freshDecision = this.applyPending(simTime);

      const staleAfter = Math.max(cfg.ai.staleAfterMs, cfg.ai.decisionIntervalMs * 2) / 1000;
      const reference = this.currentDecision ? this.lastDecisionSimTime : this.autoSince;
      const aiStale = simTime - reference > staleAfter;
      verdict = this.safety.evaluate({
        mode: 'AUTO',
        requested: this.currentDecision?.action ?? null,
        state,
        estop: this.estop,
        aiError: this.lastError,
        aiStale,
      });
      planned = this.planner.plan(verdict.action, state);
    } else {
      const fresh = Date.now() - this.manual.wall < MANUAL_DEADMAN_MS;
      const manual = fresh
        ? { linear: this.manual.throttle * cfg.robot.maxSpeed, angular: this.manual.steering * cfg.robot.maxAngularVelocity }
        : { linear: 0, angular: 0 };
      verdict = this.safety.evaluate({ mode: 'MANUAL', requested: 'MANUAL', manual, state, estop: this.estop, aiError: null, aiStale: false });
      planned = manual;
    }

    const limited = this.safety.limit(planned, verdict);
    const cmd = { linear: round(limited.linear, 4), angular: round(limited.angular, 4) };
    this.lastVerdict = verdict;
    this.lastCmd = cmd;

    const twist: Twist = { linear: { x: cmd.linear, y: 0, z: 0 }, angular: { x: 0, y: 0, z: cmd.angular } };
    this.transport.publish(TOPICS.cmdVel, twist);
    this.reportSafety(verdict, simTime, freshDecision, cmd);
  }

  private launchRequest(state: AggregatedState, simTime: number): void {
    const cfg = this.config();
    const id = ++this.requestId;
    const gen = this.generation;
    this.aiTicks++;
    this.logger.debug('STATE_GENERATED', 'StateAggregator', 'State generated', { simTime });
    this.transport.publish(TOPICS.roverState, state);
    this.logger.info('AI_REQUEST', this.engine.id, `${this.engine.id} request #${id}`, { id });

    const f = cfg.failures;
    const jitter = f.networkLatencyMs > 0 ? f.networkLatencyMs * (1 + this.latencyRng.range(-0.3, 0.3)) : 0;
    const injectedLatencyMs = Math.round(f.aiLatencyMs + jitter);

    const engine = this.engine;
    if (f.aiTimeout) {
      // Injected hang: the answer never comes; the timeout fires in sim time.
      this.pending = {
        result: { decision: null, latencyMs: cfg.ai.timeoutMs, error: { code: 'TIMEOUT', message: `injected: no answer within ${cfg.ai.timeoutMs} ms` } },
        requestSimTime: simTime,
        applyAt: simTime + cfg.ai.timeoutMs / 1000,
        injectedLatencyMs: 0,
        state,
        id,
      };
      return;
    }
    const run = async (): Promise<void> => {
      let result: DecisionResult | null = null;
      for (let attempt = 0; attempt <= cfg.ai.retries; attempt++) {
        result = await this.callEngine(engine, state, cfg.ai.timeoutMs);
        if (!result.error || (result.error.code !== 'TIMEOUT' && result.error.code !== 'NETWORK')) break;
      }
      if (gen !== this.generation || !result) return;
      // Injected latency is simulated in sim time, so it is deterministic and honours slow motion.
      let applyAt = simTime + injectedLatencyMs / 1000;
      const total = result.latencyMs + injectedLatencyMs;
      if (!result.error && total > cfg.ai.timeoutMs) {
        result = { ...result, decision: null, error: { code: 'TIMEOUT', message: `latency ${total} ms > timeout ${cfg.ai.timeoutMs} ms` } };
        applyAt = simTime + Math.max(0, cfg.ai.timeoutMs - result.latencyMs) / 1000;
      }
      this.pending = { result, requestSimTime: simTime, applyAt, injectedLatencyMs, state, id };
    };
    const p = run()
      .catch((err: unknown) => {
        this.logger.error('AutonomyStack', `Decision engine crashed: ${String(err)}`);
        if (gen === this.generation) {
          this.pending = {
            result: { decision: null, latencyMs: 0, error: { code: 'ENGINE_ERROR', message: String(err) } },
            requestSimTime: simTime,
            applyAt: simTime,
            injectedLatencyMs: 0,
            state,
            id,
          };
        }
      })
      .finally(() => {
        if (this.inflight === p) this.inflight = null;
      });
    this.inflight = p;
  }

  private async callEngine(engine: DecisionEngine, state: AggregatedState, timeoutMs: number): Promise<DecisionResult> {
    const ctrl = new AbortController();
    const started = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<DecisionResult>((resolve) => {
      timer = setTimeout(() => {
        ctrl.abort();
        resolve({ decision: null, latencyMs: Date.now() - started, error: { code: 'TIMEOUT', message: `no answer within ${timeoutMs} ms` } });
      }, timeoutMs);
    });
    try {
      const call = engine.decide(state, { signal: ctrl.signal }).catch(
        (err: unknown): DecisionResult => ({ decision: null, latencyMs: Date.now() - started, error: { code: 'ENGINE_ERROR', message: String(err) } }),
      );
      return await Promise.race([call, timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  /** Applies a completed decision once its (simulated) latency has elapsed. Returns true if a new decision was applied. */
  private applyPending(simTime: number): boolean {
    const p = this.pending;
    if (!p || simTime + 1e-9 < p.applyAt) return false;
    this.pending = null;
    const { result } = p;
    const latency = result.latencyMs + p.injectedLatencyMs;
    this.lastLatencyMs = latency;
    const model = this.getModelInfo();
    const exchange: AiExchange = {
      id: p.id,
      simTime: p.requestSimTime,
      timestamp: Date.now(),
      provider: this.engine.id,
      model: model.model,
      state: p.state,
      request: result.raw?.request ?? null,
      response: result.raw?.response ?? null,
      decision: result.decision,
      error: result.error,
      latencyMs: latency,
      injectedLatencyMs: p.injectedLatencyMs,
    };
    this.lastExchange = exchange;
    this.onExchange?.(exchange);
    this.history.push(exchange);
    if (this.history.length > 50) this.history.shift();

    if (result.decision) {
      this.currentDecision = result.decision;
      this.lastDecisionSimTime = simTime;
      this.lastError = null;
      this.decisionMeter.mark(simTime);
      if (this.engine.id !== 'mock') this.linkStatus = 'CONNECTED';
      this.logger.info('AI_RESPONSE', this.engine.id, `${this.engine.id} response #${p.id} (${latency} ms)`, { id: p.id, latencyMs: latency });
      this.logger.info('DECISION', 'DecisionEngine', `Decision: ${result.decision.action} (${Math.round(result.decision.confidence * 100)}%) ${result.decision.reason}`, result.decision);
      this.transport.publish(TOPICS.decision, { ...result.decision, latencyMs: latency, requestId: p.id });
      return true;
    }
    const err = result.error ?? { code: 'ENGINE_ERROR' as const, message: 'empty result' };
    this.lastError = err.code;
    if (this.engine.id !== 'mock') {
      this.linkStatus = err.code === 'TIMEOUT' ? 'TIMEOUT' : err.code === 'NETWORK' ? 'OFFLINE' : 'ERROR';
    }
    if (err.code === 'TIMEOUT') this.logger.warn('AI_TIMEOUT', this.engine.id, `AI_TIMEOUT #${p.id}: ${err.message}`, { id: p.id });
    else this.logger.log({ type: 'AI_ERROR', source: this.engine.id, message: `AI error #${p.id} ${err.code}: ${err.message}`, level: 'warn', payload: { id: p.id, error: err, response: result.raw?.response } });
    return false;
  }

  private reportSafety(v: SafetyDecision, simTime: number, freshDecision: boolean, cmd: VelocityCommand): void {
    const key = `${v.verdict}|${v.action}|${v.rule}`;
    const changed = key !== this.lastVerdictKey;
    this.lastVerdictKey = key;
    if (changed || freshDecision) {
      const type = v.verdict === 'ALLOW' ? 'SAFETY_ALLOW' : v.verdict === 'OVERRIDE' ? 'SAFETY_OVERRIDE' : 'SAFETY_BLOCK';
      const requested = v.requested ?? 'none';
      const msg = v.verdict === 'ALLOW' ? `Safety: ALLOW ${requested}${v.rule !== 'NONE' ? ` [${v.rule}]` : ''}` : `Safety: ${v.verdict} ${requested} → ${v.action} [${v.rule}] ${v.reason}`;
      // Repeated ALLOWs are debug-level noise; overrides/blocks are always visible.
      this.logger.log({ type, source: 'SafetyController', message: msg, level: v.verdict === 'ALLOW' ? (changed || freshDecision ? 'info' : 'debug') : 'warn', payload: v });
      this.logger.info('MOTOR_COMMAND', 'LocalPlanner', `Motor command: v=${cmd.linear.toFixed(2)} m/s ω=${cmd.angular.toFixed(2)} rad/s`, cmd);
    }
    if (changed || simTime - this.lastSafetyPublish >= 0.5) {
      this.lastSafetyPublish = simTime;
      this.transport.publish(TOPICS.safety, v);
    }
  }

  getInspector(): AiInspectorData {
    const lat = this.history.filter((h) => h.decision).map((h) => h.latencyMs);
    return {
      provider: this.engine.id,
      model: this.getModelInfo(),
      status: this.linkStatus,
      lastExchange: this.lastExchange,
      history: this.history
        .slice(-30)
        .reverse()
        .map((h) => ({ id: h.id, simTime: h.simTime, decision: h.decision, latencyMs: h.latencyMs, error: h.error })),
      decisionsPerSecond: this.decisionMeter.rate(this.lastState?.simTime ?? 0),
      avgLatencyMs: lat.length ? lat.reduce((a, b) => a + b, 0) / lat.length : null,
    };
  }

  getExchanges(): AiExchange[] {
    return this.history.slice();
  }
}
