import type { FastifyInstance, FastifyReply } from 'fastify';
import {
  createDefaultConfig,
  type AppConfig,
  type ControlMode,
  type DevMode,
  type RandomScenarioParams,
  type Scenario,
  type ServerMessage,
} from '@rover/protocol';
import { createDecisionEngine, type RoverRuntime } from '@rover/runtime';
import { PRESET_SCENARIOS, generateRandomScenario, getPreset, validateScenario } from '@rover/simulation';
import { mergeKnown } from '@rover/shared';
import type { Repository } from './db/repository';
import type { WsHub } from './ws-hub';

export interface RouteDeps {
  runtime: RoverRuntime;
  repo: Repository;
  hub: WsHub;
  baseConfig: AppConfig;
  version: string;
  startedAt: number;
  refreshHealth: () => Promise<void>;
}

const bad = (reply: FastifyReply, error: string, code = 400) => reply.code(code).send({ error });

export function statusMessage(rt: RoverRuntime): ServerMessage {
  return {
    type: 'status',
    data: {
      status: rt.status,
      mode: rt.mode,
      devMode: rt.devMode,
      recording: { active: rt.status === 'RUNNING', frames: rt.recorder.frameTotal, duration: rt.recorder.duration },
    },
  };
}

export function registerRoutes(app: FastifyInstance, deps: RouteDeps): void {
  const { runtime: rt, repo, hub } = deps;
  const pushStatus = () => hub.broadcast(statusMessage(rt));
  const pushConfig = () => {
    hub.ensureFrameTimer();
    hub.broadcast({ type: 'config', data: rt.config });
  };
  const pushScenario = () => hub.broadcast({ type: 'scenario', data: rt.scenario });

  // ------------------------------------------------------------------ health / info
  app.get('/api/health', async () => {
    let db = true;
    try {
      await repo.listRobotConfigs();
    } catch {
      db = false;
    }
    return {
      ok: true,
      version: deps.version,
      uptime: Math.round((Date.now() - deps.startedAt) / 1000),
      simulation: { status: rt.status, simTime: rt.simTime, mode: rt.mode, devMode: rt.devMode },
      ai: { provider: rt.config.ai.provider, status: rt.autonomy.linkStatus },
      database: db ? 'ok' : 'error',
      wsClients: hub.clientCount,
    };
  });

  app.get('/api/robot', async () => ({
    frame: rt.buildFrame(),
    robot: rt.config.robot,
    battery: rt.config.battery,
    state: rt.autonomy.lastState,
  }));

  app.get('/api/state', async () => rt.autonomy.lastState);
  app.get('/api/ai', async () => rt.autonomy.getInspector());

  app.get('/api/topics', async () => rt.transport.getTopicInfo());
  app.get<{ Querystring: { name?: string } }>('/api/topics/message', async (req, reply) => {
    const name = req.query.name;
    if (!name) return bad(reply, 'query parameter "name" required');
    const msg = rt.transport.getLastMessage(name);
    return msg ?? bad(reply, `no message on ${name}`, 404);
  });

  app.get<{ Querystring: { limit?: string; category?: string } }>('/api/logs', async (req) => {
    const limit = Math.min(5000, Number(req.query.limit ?? 500) || 500);
    const cat = req.query.category?.toUpperCase();
    return rt.logger.recent(limit, cat && cat !== 'ALL' ? (cat as never) : undefined);
  });

  // ------------------------------------------------------------------ config
  app.get('/api/config', async () => rt.config);

  app.patch('/api/config', async (req, reply) => {
    if (typeof req.body !== 'object' || req.body === null) return bad(reply, 'JSON object expected');
    const changed = rt.updateConfig(req.body);
    pushConfig();
    if (changed.some((c) => c.startsWith('ai.'))) void deps.refreshHealth();
    return { changed, config: rt.config };
  });

  app.post('/api/config/reset', async () => {
    const fresh = structuredClone(deps.baseConfig);
    fresh.failures = rt.config.failures;
    rt.updateConfig(fresh);
    pushConfig();
    return rt.config;
  });

  // ------------------------------------------------------------------ simulation control
  app.post<{ Body: { action?: string; steps?: number } }>('/api/sim/control', async (req, reply) => {
    const action = req.body?.action;
    switch (action) {
      case 'run':
      case 'resume':
      case 'start':
        if (!rt.start()) return bad(reply, 'simulation unavailable in REAL_ROBOT mode', 409);
        break;
      case 'pause':
        rt.pause();
        break;
      case 'step':
        await rt.stepOnce(Math.max(1, Math.min(1000, Number(req.body?.steps ?? 1) || 1)));
        hub.broadcast({ type: 'frame', data: rt.buildFrame() });
        break;
      case 'reset':
        await rt.reset();
        hub.broadcast({ type: 'frame', data: rt.buildFrame() });
        break;
      default:
        return bad(reply, 'action must be one of run|pause|step|reset');
    }
    pushStatus();
    return { status: rt.status, simTime: rt.simTime };
  });

  app.post<{ Body: { action?: string } }>('/api/sim/mission', async (req, reply) => {
    const m = rt.sim.mission;
    switch (req.body?.action) {
      case 'start':
        m.start();
        break;
      case 'pause':
        m.pause();
        break;
      case 'abort':
        m.abort();
        break;
      default:
        return bad(reply, 'action must be start|pause|abort');
    }
    return { state: m.state };
  });

  app.post<{ Body: { mode?: ControlMode } }>('/api/sim/mode', async (req, reply) => {
    const mode = req.body?.mode;
    if (mode !== 'MANUAL' && mode !== 'AUTO') return bad(reply, 'mode must be MANUAL or AUTO');
    rt.setMode(mode);
    pushStatus();
    return { mode: rt.mode };
  });

  app.post<{ Body: { devMode?: DevMode } }>('/api/sim/dev-mode', async (req, reply) => {
    const m = req.body?.devMode;
    if (m !== 'SIMULATION' && m !== 'SIMULATION_LOCAL_AI' && m !== 'REAL_ROBOT') return bad(reply, 'invalid devMode');
    rt.setDevMode(m);
    pushStatus();
    pushConfig();
    void deps.refreshHealth();
    return { devMode: rt.devMode, status: rt.status };
  });

  app.post<{ Body: { engaged?: boolean } }>('/api/sim/estop', async (req) => {
    rt.autonomy.setEstop(Boolean(req.body?.engaged));
    return { estop: rt.autonomy.estop };
  });

  app.post<{ Body: { throttle?: number; steering?: number } }>('/api/sim/manual', async (req) => {
    rt.autonomy.setManual(Number(req.body?.throttle ?? 0), Number(req.body?.steering ?? 0));
    return { ok: true };
  });

  app.get('/api/sim/scenario', async () => rt.scenario);

  app.put('/api/sim/scenario', async (req, reply) => {
    const v = validateScenario(req.body);
    if (!v.ok) return bad(reply, v.error);
    await rt.loadScenario(v.scenario);
    pushScenario();
    pushConfig();
    pushStatus();
    hub.broadcast({ type: 'frame', data: rt.buildFrame() });
    return rt.scenario;
  });

  // ------------------------------------------------------------------ scenarios
  app.get('/api/scenarios', async () => {
    let saved: Scenario[] = [];
    try {
      saved = await repo.listScenarios();
    } catch (err) {
      app.log.error(err);
    }
    return { presets: PRESET_SCENARIOS, saved };
  });

  app.get<{ Params: { id: string } }>('/api/scenarios/:id', async (req, reply) => {
    const s = getPreset(req.params.id) ?? (await repo.getScenario(req.params.id));
    return s ?? bad(reply, 'scenario not found', 404);
  });

  app.post('/api/scenarios', async (req, reply) => {
    const v = validateScenario(req.body);
    if (!v.ok) return bad(reply, v.error);
    return repo.saveScenario(v.scenario);
  });

  app.put<{ Params: { id: string } }>('/api/scenarios/:id', async (req, reply) => {
    const v = validateScenario({ ...(req.body as object), id: req.params.id });
    if (!v.ok) return bad(reply, v.error);
    return repo.saveScenario(v.scenario);
  });

  app.delete<{ Params: { id: string } }>('/api/scenarios/:id', async (req, reply) => {
    const ok = await repo.deleteScenario(req.params.id);
    return ok ? { ok } : bad(reply, 'scenario not found', 404);
  });

  app.post<{ Body: Partial<RandomScenarioParams> & { load?: boolean } }>('/api/scenarios/generate', async (req) => {
    const b = req.body ?? {};
    const params: RandomScenarioParams = {
      numberOfObstacles: clampInt(b.numberOfObstacles, 0, 200, 15),
      minimumDistance: clampNum(b.minimumDistance, 0, 20, 1.5),
      maximumDistance: clampNum(b.maximumDistance, 5, 200, 30),
      difficulty: b.difficulty === 'easy' || b.difficulty === 'hard' ? b.difficulty : 'medium',
      seed: clampInt(b.seed, 0, 2 ** 31 - 1, Math.floor(Math.random() * 1e6)),
      width: b.width ? clampNum(b.width, 10, 200, 40) : undefined,
      height: b.height ? clampNum(b.height, 10, 200, 30) : undefined,
    };
    const scenario = generateRandomScenario(params);
    if (b.load) {
      await rt.loadScenario(scenario);
      pushScenario();
      pushStatus();
      hub.broadcast({ type: 'frame', data: rt.buildFrame() });
    }
    return { params, scenario };
  });

  // ------------------------------------------------------------------ robot configurations
  app.get('/api/robot-configs', async () => repo.listRobotConfigs());
  app.post<{ Body: { name?: string } }>('/api/robot-configs', async (req, reply) => {
    const name = req.body?.name?.trim();
    if (!name) return bad(reply, 'name required');
    const { robot, battery, sensors, planner, safety } = rt.config;
    return repo.saveRobotConfig(name, { robot, battery, sensors, planner, safety });
  });
  app.post<{ Params: { id: string } }>('/api/robot-configs/:id/apply', async (req, reply) => {
    const c = await repo.getRobotConfig(req.params.id);
    if (!c) return bad(reply, 'configuration not found', 404);
    rt.updateConfig(c.data);
    pushConfig();
    return rt.config;
  });
  app.delete<{ Params: { id: string } }>('/api/robot-configs/:id', async (req) => {
    await repo.deleteRobotConfig(req.params.id);
    return { ok: true };
  });

  // ------------------------------------------------------------------ runs (recording / replay)
  app.get('/api/runs', async () => repo.listRuns());

  app.post<{ Body: { name?: string } }>('/api/runs', async (req, reply) => {
    const snap = rt.recorder.snapshot(rt.autonomy.engineId);
    if (snap.frames.length === 0) return bad(reply, 'nothing recorded yet: run the simulation first', 409);
    const name = req.body?.name?.trim() || `${snap.scenario.name} · ${snap.summary.provider} · ${new Date().toISOString().slice(0, 19).replace('T', ' ')}`;
    const id = await repo.saveRun(name, snap);
    rt.logger.info('INFO', 'RunManager', `Run saved: ${name} (${snap.frames.length} frames)`, { id });
    return { id, name, summary: snap.summary };
  });

  app.get<{ Params: { id: string } }>('/api/runs/:id', async (req, reply) => {
    const run = await repo.getRun(req.params.id);
    return run ?? bad(reply, 'run not found', 404);
  });

  app.delete<{ Params: { id: string } }>('/api/runs/:id', async (req, reply) => {
    const ok = await repo.deleteRun(req.params.id);
    return ok ? { ok } : bad(reply, 'run not found', 404);
  });

  /** Loads the scenario + config of a recorded run back into the simulator (for A/B comparisons). */
  app.post<{ Params: { id: string } }>('/api/runs/:id/restore', async (req, reply) => {
    const run = await repo.getRun(req.params.id);
    if (!run) return bad(reply, 'run not found', 404);
    await rt.loadScenario(run.scenario);
    rt.updateConfig(run.config);
    await rt.reset();
    pushScenario();
    pushConfig();
    pushStatus();
    hub.broadcast({ type: 'frame', data: rt.buildFrame() });
    return { ok: true };
  });

  // ------------------------------------------------------------------ AI
  app.post<{ Body: { ai?: Partial<AppConfig['ai']> } }>('/api/jev/test', async (req) => {
    const cfg = structuredClone(rt.config);
    if (req.body?.ai) mergeKnown(cfg.ai as unknown as Record<string, unknown>, req.body.ai);
    const provider = cfg.ai.provider === 'mock' ? 'local-jev' : cfg.ai.provider;
    const engine = createDecisionEngine(provider, () => cfg);
    const health = await engine.healthCheck();
    const state = rt.autonomy.lastState ?? rt.autonomy.aggregator.build(rt.simTime);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), cfg.ai.timeoutMs);
    let decision;
    try {
      decision = await engine.decide(state, { signal: ctrl.signal });
    } finally {
      clearTimeout(timer);
    }
    return { provider, health, model: engine.getModelInfo(), result: decision };
  });

  app.post('/api/jev/health', async () => {
    await deps.refreshHealth();
    return { status: rt.autonomy.linkStatus, healthOk: rt.autonomy.healthOk };
  });

  app.get('/api/defaults', async () => ({ config: createDefaultConfig() }));
}

function clampNum(v: unknown, min: number, max: number, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) && v !== undefined && v !== null && v !== '' ? Math.max(min, Math.min(max, n)) : fallback;
}

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  return Math.round(clampNum(v, min, max, fallback));
}
