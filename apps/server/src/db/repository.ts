import { randomUUID } from 'node:crypto';
import { asc, desc, eq } from 'drizzle-orm';
import type { AiExchange, AppConfig, LogEvent, Scenario, SimFrame } from '@rover/protocol';
import type { RecordedRun, RunSummary } from '@rover/runtime';
import type { DbHandle } from './client';
import { aiRequests, aiResponses, robotConfigurations, scenarios, simulationEvents, simulationRuns } from './schema';

export interface RunListItem {
  id: string;
  name: string;
  scenarioName: string;
  provider: string;
  seed: number;
  duration: number;
  summary: RunSummary;
  createdAt: number;
}

export interface RunDetail extends RunListItem {
  config: AppConfig;
  scenario: Scenario;
  frames: SimFrame[];
  events: LogEvent[];
  exchanges: Array<Pick<AiExchange, 'id' | 'simTime' | 'provider' | 'model' | 'decision' | 'error' | 'latencyMs' | 'injectedLatencyMs' | 'state' | 'request' | 'response'>>;
}

const FRAME_TYPE = 'TELEMETRY_FRAME';
const CHUNK = 200;

function chunks<T>(items: T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Persistence for scenarios, robot configurations and recorded runs. */
export class Repository {
  constructor(private readonly h: DbHandle) {}

  // ------------------------------------------------------------ scenarios
  async listScenarios(): Promise<Scenario[]> {
    const rows = await this.h.db.select().from(scenarios).orderBy(desc(scenarios.updatedAt));
    return rows.map((r) => ({ ...(r.data as Scenario), id: r.id, builtIn: false }));
  }

  async getScenario(id: string): Promise<Scenario | null> {
    const rows = await this.h.db.select().from(scenarios).where(eq(scenarios.id, id));
    return rows[0] ? { ...(rows[0].data as Scenario), id: rows[0].id, builtIn: false } : null;
  }

  async saveScenario(s: Scenario): Promise<Scenario> {
    const now = Date.now();
    // Re-saving a stored scenario updates it; anything else (preset, random, draft) gets a new id.
    const existing = s.id ? await this.getScenario(s.id) : null;
    const id = existing ? existing.id : `scn-${randomUUID().slice(0, 8)}`;
    const data = { ...s, id, builtIn: false };
    if (existing) {
      await this.h.db.update(scenarios).set({ name: s.name, description: s.description, data, updatedAt: now }).where(eq(scenarios.id, id));
    } else {
      await this.h.db.insert(scenarios).values({ id, name: s.name, description: s.description ?? '', data, createdAt: now, updatedAt: now });
    }
    return data;
  }

  async deleteScenario(id: string): Promise<boolean> {
    const existing = await this.getScenario(id);
    if (!existing) return false;
    await this.h.db.delete(scenarios).where(eq(scenarios.id, id));
    return true;
  }

  // ------------------------------------------------------------ robot configurations
  async listRobotConfigs(): Promise<Array<{ id: string; name: string; data: unknown; createdAt: number }>> {
    return this.h.db.select().from(robotConfigurations).orderBy(desc(robotConfigurations.createdAt));
  }

  async saveRobotConfig(name: string, data: unknown): Promise<{ id: string }> {
    const id = `cfg-${randomUUID().slice(0, 8)}`;
    await this.h.db.insert(robotConfigurations).values({ id, name, data, createdAt: Date.now() });
    return { id };
  }

  async getRobotConfig(id: string): Promise<{ id: string; name: string; data: unknown } | null> {
    const rows = await this.h.db.select().from(robotConfigurations).where(eq(robotConfigurations.id, id));
    return rows[0] ?? null;
  }

  async deleteRobotConfig(id: string): Promise<void> {
    await this.h.db.delete(robotConfigurations).where(eq(robotConfigurations.id, id));
  }

  // ------------------------------------------------------------ runs
  async saveRun(name: string, run: RecordedRun): Promise<string> {
    const id = `run-${randomUUID().slice(0, 8)}`;
    await this.h.transaction(async () => {
      await this.h.db.insert(simulationRuns).values({
        id,
        name,
        scenarioId: run.scenario.id,
        scenarioName: run.scenario.name,
        provider: run.summary.provider,
        seed: run.seed,
        duration: run.duration,
        summary: run.summary,
        config: run.config,
        scenario: run.scenario,
        createdAt: Date.now(),
      });
      const frameRows = run.frames.map((f) => ({
        runId: id,
        simTime: f.simTime,
        timestamp: f.wallTime,
        type: FRAME_TYPE,
        category: 'FRAME',
        level: 'debug',
        source: 'RunRecorder',
        message: '',
        payload: f,
      }));
      const eventRows = run.events.map((e) => ({
        runId: id,
        simTime: e.simulationTime,
        timestamp: e.timestamp,
        type: e.type,
        category: e.category,
        level: e.level,
        source: e.source,
        message: e.message,
        payload: e.payload ?? null,
      }));
      for (const c of chunks([...frameRows, ...eventRows])) await this.h.db.insert(simulationEvents).values(c);
      for (const c of chunks(run.exchanges)) {
        await this.h.db.insert(aiRequests).values(
          c.map((x) => ({ runId: id, requestId: x.id, simTime: x.simTime, provider: x.provider, model: x.model, state: x.state, request: x.request ?? null, timestamp: x.timestamp })),
        );
        await this.h.db.insert(aiResponses).values(
          c.map((x) => ({
            runId: id,
            requestId: x.id,
            simTime: x.simTime,
            latencyMs: x.latencyMs,
            injectedLatencyMs: x.injectedLatencyMs,
            decision: x.decision ?? null,
            error: x.error ?? null,
            response: x.response ?? null,
          })),
        );
      }
    });
    return id;
  }

  async listRuns(): Promise<RunListItem[]> {
    const rows = await this.h.db
      .select({
        id: simulationRuns.id,
        name: simulationRuns.name,
        scenarioName: simulationRuns.scenarioName,
        provider: simulationRuns.provider,
        seed: simulationRuns.seed,
        duration: simulationRuns.duration,
        summary: simulationRuns.summary,
        createdAt: simulationRuns.createdAt,
      })
      .from(simulationRuns)
      .orderBy(desc(simulationRuns.createdAt));
    return rows.map((r) => ({ ...r, summary: r.summary as RunSummary }));
  }

  async getRun(id: string): Promise<RunDetail | null> {
    const runs = await this.h.db.select().from(simulationRuns).where(eq(simulationRuns.id, id));
    const r = runs[0];
    if (!r) return null;
    const rows = await this.h.db.select().from(simulationEvents).where(eq(simulationEvents.runId, id)).orderBy(asc(simulationEvents.simTime), asc(simulationEvents.id));
    const frames: SimFrame[] = [];
    const events: LogEvent[] = [];
    for (const e of rows) {
      if (e.type === FRAME_TYPE) frames.push(e.payload as SimFrame);
      else
        events.push({
          id: e.id,
          timestamp: e.timestamp,
          simulationTime: e.simTime,
          type: e.type as LogEvent['type'],
          category: e.category as LogEvent['category'],
          level: e.level as LogEvent['level'],
          source: e.source,
          message: e.message,
          payload: e.payload ?? undefined,
        });
    }
    const reqs = await this.h.db.select().from(aiRequests).where(eq(aiRequests.runId, id)).orderBy(asc(aiRequests.id));
    const resps = await this.h.db.select().from(aiResponses).where(eq(aiResponses.runId, id)).orderBy(asc(aiResponses.id));
    const byReq = new Map(resps.map((x) => [x.requestId, x]));
    const exchanges = reqs.map((q) => {
      const a = byReq.get(q.requestId);
      return {
        id: q.requestId,
        simTime: q.simTime,
        provider: q.provider,
        model: q.model,
        state: q.state as AiExchange['state'],
        request: q.request,
        response: a?.response ?? null,
        decision: (a?.decision ?? null) as AiExchange['decision'],
        error: (a?.error ?? undefined) as AiExchange['error'],
        latencyMs: a?.latencyMs ?? 0,
        injectedLatencyMs: a?.injectedLatencyMs ?? 0,
      };
    });
    return {
      id: r.id,
      name: r.name,
      scenarioName: r.scenarioName,
      provider: r.provider,
      seed: r.seed,
      duration: r.duration,
      summary: r.summary as RunSummary,
      createdAt: r.createdAt,
      config: r.config as AppConfig,
      scenario: r.scenario as Scenario,
      frames,
      events,
      exchanges,
    };
  }

  async deleteRun(id: string): Promise<boolean> {
    const runs = await this.h.db.select({ id: simulationRuns.id }).from(simulationRuns).where(eq(simulationRuns.id, id));
    if (!runs[0]) return false;
    await this.h.transaction(async () => {
      await this.h.db.delete(simulationEvents).where(eq(simulationEvents.runId, id));
      await this.h.db.delete(aiRequests).where(eq(aiRequests.runId, id));
      await this.h.db.delete(aiResponses).where(eq(aiResponses.runId, id));
      await this.h.db.delete(simulationRuns).where(eq(simulationRuns.id, id));
    });
    return true;
  }
}
