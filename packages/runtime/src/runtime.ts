import {
  createDefaultFailures,
  type AiProvider,
  type AppConfig,
  type ControlMode,
  type DebugStats,
  type DevMode,
  type FailureConfig,
  type Scenario,
  type SimFrame,
  type SimStatus,
} from '@rover/protocol';
import { AutonomyStack } from '@rover/autonomy';
import type { DecisionEngine } from '@rover/decision-engine';
import { EventLogger } from '@rover/logging';
import { SimulationEngine, getPreset } from '@rover/simulation';
import { RateMeter, mergeKnown, rad2deg, round, wrapAngle } from '@rover/shared';
import { SimulationTransport } from '@rover/transport';
import { createDecisionEngine } from './engines';
import { RunRecorder } from './recorder';

export interface RuntimeOptions {
  config: AppConfig;
  scenario?: Scenario;
  /** Override the engine factory (tests, custom engines). */
  engineFactory?: (provider: AiProvider, config: () => AppConfig) => DecisionEngine;
  logCapacity?: number;
}

/**
 * Composition root of the robot software. Owns the transport, the simulated robot,
 * the autonomy stack, the logger and the recorder, and drives them either headless
 * (`runFor`) or in real time (`start`).
 */
export class RoverRuntime {
  config: AppConfig;
  readonly transport: SimulationTransport;
  readonly logger: EventLogger;
  readonly sim: SimulationEngine;
  readonly autonomy: AutonomyStack;
  readonly recorder = new RunRecorder();
  status: SimStatus = 'PAUSED';
  devMode: DevMode = 'SIMULATION';
  scenario: Scenario;

  private readonly engineFactory: NonNullable<RuntimeOptions['engineFactory']>;
  private loopTimer: ReturnType<typeof setTimeout> | null = null;
  private loopBusy = false;
  private lastWall = 0;
  private accumulator = 0;
  private readonly tickMeter = new RateMeter(2);
  private stepDurationMs = 0;
  private loopLagMs = 0;
  private realtimeFactor = 0;
  private rfWindow = { wall: 0, sim: 0 };
  private stepping: Promise<void> | null = null;
  /** Called after every tick (server hooks broadcasting here). */
  onTick: (() => void) | null = null;

  constructor(opts: RuntimeOptions) {
    this.config = structuredClone(opts.config);
    this.scenario = structuredClone(opts.scenario ?? getPreset('SINGLE_OBSTACLE')!);
    this.engineFactory = opts.engineFactory ?? createDecisionEngine;
    const clock = { now: () => this.sim?.simTime ?? 0 };
    this.transport = new SimulationTransport(clock);
    this.logger = new EventLogger(clock.now, opts.logCapacity ?? 5000);
    this.transport.setErrorHandler((topic, err) => this.logger.error('SimulationTransport', `Subscriber error on ${topic}: ${String(err)}`));
    this.applyScenarioConfig(this.scenario);
    this.sim = new SimulationEngine({ transport: this.transport, logger: this.logger, config: this.config, scenario: this.scenario });
    const cfg = () => this.config;
    this.autonomy = new AutonomyStack({ transport: this.transport, logger: this.logger, config: cfg, engine: this.engineFactory(this.config.ai.provider, cfg) });
    this.autonomy.onExchange = (ex) => this.recorder.addExchange(ex);
    this.logger.subscribe((e) => this.recorder.addEvent(e));
    this.recorder.begin(this.scenario, this.config);
    this.logger.info('SCENARIO_LOADED', 'RoverRuntime', `Scenario "${this.scenario.name}" loaded`);
  }

  get simTime(): number {
    return this.sim.simTime;
  }

  get mode(): ControlMode {
    return this.autonomy.mode;
  }

  // ---------------------------------------------------------------- stepping

  /** Advances the whole system by one physics tick. */
  async step(): Promise<void> {
    const t0 = performance.now();
    const dt = 1 / this.config.simulation.hz;
    try {
      this.sim.step(dt);
      await this.autonomy.tick(this.sim.simTime);
      this.recorder.offerFrame(this.sim.simTime, this.config.simulation.recordFrequency, () => this.buildFrame());
    } catch (err) {
      // Never let a single faulty tick bring the simulation down.
      this.logger.error('RoverRuntime', `Tick failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    this.tickMeter.mark(performance.now() / 1000);
    this.stepDurationMs = this.stepDurationMs * 0.95 + (performance.now() - t0) * 0.05;
    this.onTick?.();
  }

  /** Headless run for `seconds` of sim time (tests, batch comparisons). */
  async runFor(seconds: number, opts: { startMission?: boolean } = {}): Promise<void> {
    if (opts.startMission ?? true) this.sim.mission.start();
    const steps = Math.round(seconds * this.config.simulation.hz);
    for (let i = 0; i < steps; i++) await this.step();
  }

  // ---------------------------------------------------------------- realtime loop

  start(): boolean {
    if (this.devMode === 'REAL_ROBOT') {
      this.logger.warn('SIM_CONTROL', 'RoverRuntime', 'REAL_ROBOT mode: no ROS2 transport connected, simulation disabled');
      return false;
    }
    if (this.status === 'RUNNING') return true;
    this.status = 'RUNNING';
    this.sim.mission.start();
    this.lastWall = performance.now();
    this.accumulator = 0;
    this.rfWindow = { wall: this.lastWall, sim: this.sim.simTime };
    this.logger.info('SIM_CONTROL', 'RoverRuntime', 'Simulation RUNNING');
    this.scheduleWake();
    return true;
  }

  pause(): void {
    if (this.status !== 'RUNNING') return;
    this.status = 'PAUSED';
    if (this.loopTimer) clearTimeout(this.loopTimer);
    this.loopTimer = null;
    this.sim.mission.pause();
    this.logger.info('SIM_CONTROL', 'RoverRuntime', `Simulation PAUSED at ${this.sim.simTime.toFixed(2)} s`);
  }

  async stepOnce(n = 1): Promise<void> {
    if (this.status === 'RUNNING') this.pause();
    if (this.devMode === 'REAL_ROBOT') return;
    this.sim.mission.start();
    for (let i = 0; i < n; i++) await this.step();
  }

  async reset(): Promise<void> {
    const wasRunning = this.status === 'RUNNING';
    this.pause();
    await this.stepping;
    this.applyScenarioConfig(this.scenario);
    this.transport.resetStats();
    this.sim.loadScenario(this.scenario, this.config);
    this.autonomy.reset();
    this.recorder.begin(this.scenario, this.config);
    this.status = this.devMode === 'REAL_ROBOT' ? 'UNAVAILABLE' : 'PAUSED';
    this.logger.info('SIM_CONTROL', 'RoverRuntime', `Simulation RESET${wasRunning ? ' (was running)' : ''}`);
  }

  async loadScenario(scenario: Scenario): Promise<void> {
    this.scenario = structuredClone(scenario);
    this.config.failures = createDefaultFailures();
    await this.reset();
    this.logger.info('SCENARIO_LOADED', 'RoverRuntime', `Scenario "${scenario.name}" loaded`, { id: scenario.id });
  }

  private scheduleWake(): void {
    this.loopTimer = setTimeout(() => {
      this.stepping = this.wake();
    }, 4);
  }

  private async wake(): Promise<void> {
    if (this.status !== 'RUNNING' || this.loopBusy) return;
    this.loopBusy = true;
    try {
      const now = performance.now();
      const elapsed = (now - this.lastWall) / 1000;
      this.loopLagMs = Math.max(0, now - this.lastWall - 4);
      this.lastWall = now;
      const speed = Math.max(0.01, this.config.simulation.speed);
      const dt = 1 / this.config.simulation.hz;
      this.accumulator += elapsed * speed;
      // Bound catch-up work to ~100 ms of sim per wake; drop the rest if the host is too slow.
      const maxSteps = Math.max(1, Math.ceil(0.1 * speed * this.config.simulation.hz));
      let n = 0;
      while (this.accumulator >= dt && n < maxSteps && this.status === 'RUNNING') {
        await this.step();
        this.accumulator -= dt;
        n++;
      }
      if (this.accumulator > dt * maxSteps) this.accumulator = 0;
      if (now - this.rfWindow.wall > 1000) {
        this.realtimeFactor = (this.sim.simTime - this.rfWindow.sim) / ((now - this.rfWindow.wall) / 1000);
        this.rfWindow = { wall: now, sim: this.sim.simTime };
      }
    } finally {
      this.loopBusy = false;
      if (this.status === 'RUNNING') this.scheduleWake();
    }
  }

  // ---------------------------------------------------------------- control

  setMode(mode: ControlMode): void {
    this.autonomy.setMode(mode, this.sim.simTime);
  }

  setDevMode(mode: DevMode): void {
    if (mode === this.devMode) return;
    this.devMode = mode;
    if (mode === 'REAL_ROBOT') {
      this.pause();
      this.status = 'UNAVAILABLE';
    } else {
      if (this.status === 'UNAVAILABLE') this.status = 'PAUSED';
      if (mode === 'SIMULATION_LOCAL_AI' && this.config.ai.provider === 'mock') this.updateConfig({ ai: { provider: 'local-jev' } });
      if (mode === 'SIMULATION' && this.config.ai.provider !== 'mock') this.updateConfig({ ai: { provider: 'mock' } });
    }
    this.logger.info('MODE_CHANGED', 'RoverRuntime', `Development mode: ${mode}`);
  }

  /** Applies a (deep, partial) config patch live. Returns the changed paths. */
  updateConfig(patch: unknown): string[] {
    const prevProvider = this.config.ai.provider;
    const prevFailures = { ...this.config.failures };
    const changed = mergeKnown(this.config as unknown as Record<string, unknown>, patch);
    if (changed.length === 0) return changed;
    const c = this.config;
    c.simulation.hz = clampNum(c.simulation.hz, 1, 200);
    c.simulation.speed = clampNum(c.simulation.speed, 0.01, 50);
    c.ai.decisionIntervalMs = clampNum(c.ai.decisionIntervalMs, 20, 60_000);
    c.ai.timeoutMs = clampNum(c.ai.timeoutMs, 10, 120_000);
    c.ai.retries = clampNum(Math.round(c.ai.retries), 0, 5);
    c.sensors.lidar.numberOfRays = clampNum(Math.round(c.sensors.lidar.numberOfRays), 2, 2000);
    c.planner.controlFrequency = clampNum(c.planner.controlFrequency, 1, 200);
    this.sim.setConfig(c);
    if (c.ai.provider !== prevProvider) {
      this.autonomy.setEngine(this.engineFactory(c.ai.provider, () => this.config));
    }
    this.reportFailureChanges(prevFailures, c.failures);
    this.logger.info('CONFIG_CHANGED', 'RoverRuntime', `Config updated: ${changed.slice(0, 6).join(', ')}${changed.length > 6 ? '…' : ''}`, { changed });
    return changed;
  }

  private reportFailureChanges(prev: FailureConfig, next: FailureConfig): void {
    for (const key of Object.keys(next) as Array<keyof FailureConfig>) {
      if (prev[key] !== next[key]) {
        this.logger.warn('FAILURE_INJECTED', 'FailureInjector', `${key}: ${String(prev[key])} → ${String(next[key])}`, { key, value: next[key] });
      }
    }
  }

  private applyScenarioConfig(s: Scenario): void {
    if (s.failures) Object.assign(this.config.failures, s.failures);
    const gps = s.overrides?.sensors?.gps?.enabled;
    if (typeof gps === 'boolean') this.config.sensors.gps.enabled = gps;
  }

  // ---------------------------------------------------------------- views

  buildFrame(): SimFrame {
    const r = this.sim.rover;
    const m = this.sim.mission;
    const odom = this.sim.sensors.odom;
    const goal = m.goal;
    const dist = goal ? Math.hypot(goal.x - r.x, goal.y - r.y) : null;
    const bearing = goal ? rad2deg(wrapAngle(Math.atan2(goal.y - r.y, goal.x - r.x) - r.heading)) : null;
    const scan = this.transport.getLastMessage<{ angle_min: number; angle_increment: number; range_max: number; ranges: number[] }>('/scan');
    const gps = this.transport.getLastMessage<{ status: { status: number }; latitude: number; longitude: number }>('/gps');
    const v = this.autonomy.lastVerdict;
    return {
      tick: this.sim.tick,
      simTime: round(this.sim.simTime, 3),
      wallTime: Date.now(),
      status: this.status,
      mode: this.autonomy.mode,
      devMode: this.devMode,
      pose: { x: round(r.x, 3), y: round(r.y, 3), heading: round(r.heading, 4) },
      odomPose: { x: round(odom.x, 3), y: round(odom.y, 3), heading: round(odom.heading, 4) },
      velocity: { linear: round(r.linear, 3), angular: round(r.angular, 3) },
      acceleration: round(r.acceleration, 3),
      battery: {
        percentage: round(r.battery.percentage, 2),
        voltage: round(r.battery.voltage, 2),
        current: round(r.battery.current, 2),
        remainingTime: Number.isFinite(r.battery.remainingTime) ? Math.round(r.battery.remainingTime) : -1,
        health: r.battery.health,
      },
      motors: {
        left: roundMotor(r.left.snapshot(this.config.robot)),
        right: roundMotor(r.right.snapshot(this.config.robot)),
      },
      cmdVel: { linear: this.autonomy.lastCmd.linear, angular: this.autonomy.lastCmd.angular },
      decision: this.autonomy.currentDecision,
      safety: v ? { verdict: v.verdict, action: v.action, requested: v.requested, rule: v.rule, reason: v.reason, speedScale: v.speedScale } : null,
      mission: {
        state: m.state,
        goal,
        goalIndex: m.goalIndex,
        goalCount: m.goals.length,
        distance: dist === null ? null : round(dist, 2),
        bearing: bearing === null ? null : round(bearing, 1),
        eta: dist !== null && r.linear > 0.05 ? round(dist / r.linear, 1) : null,
        elapsed: round(m.elapsed, 2),
      },
      lidar:
        scan && this.sim.simTime - scan.simTime < 0.5
          ? { angleMin: scan.data.angle_min, angleIncrement: scan.data.angle_increment, rangeMax: scan.data.range_max, ranges: scan.data.ranges.map((x) => round(x, 2)) }
          : null,
      gps: gps ? { fix: gps.data.status.status === 0 && this.sim.simTime - gps.simTime < 1.5, latitude: gps.data.latitude, longitude: gps.data.longitude } : null,
      collision: r.inContact,
      collisions: r.collisions,
      estop: this.autonomy.estop,
      ai: { status: this.autonomy.linkStatus, provider: this.autonomy.engineId, latencyMs: this.autonomy.lastLatencyMs, inFlight: this.autonomy.inFlight },
    };
  }

  debugStats(extra: { wsMessageRate: number; wsClients: number }): DebugStats {
    const now = performance.now() / 1000;
    const sensorTickRates: Record<string, number> = {};
    for (const t of this.transport.getTopicInfo()) sensorTickRates[t.name] = round(t.frequency, 1);
    const mem = typeof process !== 'undefined' ? process.memoryUsage().rss / 1024 / 1024 : null;
    return {
      simTickRate: round(this.tickMeter.rate(now), 1),
      sensorTickRates,
      aiTickRate: round(this.autonomy.getInspector().decisionsPerSecond, 2),
      wsMessageRate: round(extra.wsMessageRate, 1),
      wsClients: extra.wsClients,
      simTime: round(this.sim.simTime, 2),
      ticks: this.sim.tick,
      realtimeFactor: this.status === 'RUNNING' ? round(this.realtimeFactor, 2) : 0,
      stepDurationMs: round(this.stepDurationMs, 3),
      cpuPercent: null,
      memoryMb: mem === null ? null : round(mem, 1),
      loopLagMs: round(this.loopLagMs, 1),
    };
  }

  dispose(): void {
    this.pause();
  }
}

function clampNum(v: number, min: number, max: number): number {
  return Number.isFinite(v) ? Math.max(min, Math.min(max, v)) : min;
}

function roundMotor(m: { rpm: number; temperature: number; current: number; voltage: number; error: SimFrame['motors']['left']['error'] }): SimFrame['motors']['left'] {
  return { rpm: round(m.rpm, 1), temperature: round(m.temperature, 2), current: round(m.current, 2), voltage: round(m.voltage, 2), error: m.error };
}
