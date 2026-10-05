import type { AiExchange, AppConfig, DeepPartial, LogEvent, RandomScenarioParams, Scenario, SimFrame } from '@rover/protocol';

export interface RunSummary {
  duration: number;
  frames: number;
  events: number;
  decisions: number;
  collisions: number;
  missionState: string;
  distanceTravelled: number;
  finalBattery: number;
  provider: string;
}

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
  exchanges: Array<Partial<AiExchange> & { id: number; simTime: number }>;
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error((data && data.error) || `HTTP ${res.status}`);
  return data as T;
}

export const api = {
  control: (action: 'run' | 'pause' | 'step' | 'reset', steps?: number) => request('POST', '/api/sim/control', { action, steps }),
  mission: (action: 'start' | 'pause' | 'abort') => request('POST', '/api/sim/mission', { action }),
  setMode: (mode: 'MANUAL' | 'AUTO') => request('POST', '/api/sim/mode', { mode }),
  setDevMode: (devMode: string) => request('POST', '/api/sim/dev-mode', { devMode }),
  estop: (engaged: boolean) => request('POST', '/api/sim/estop', { engaged }),
  patchConfig: (patch: DeepPartial<AppConfig>) => request<{ changed: string[]; config: AppConfig }>('PATCH', '/api/config', patch),
  resetConfig: () => request<AppConfig>('POST', '/api/config/reset'),
  loadScenario: (s: Scenario) => request<Scenario>('PUT', '/api/sim/scenario', s),
  listScenarios: () => request<{ presets: Scenario[]; saved: Scenario[] }>('GET', '/api/scenarios'),
  saveScenario: (s: Scenario) => request<Scenario>('POST', '/api/scenarios', s),
  deleteScenario: (id: string) => request('DELETE', `/api/scenarios/${encodeURIComponent(id)}`),
  generateScenario: (p: Partial<RandomScenarioParams> & { load?: boolean }) => request<{ scenario: Scenario }>('POST', '/api/scenarios/generate', p),
  listRuns: () => request<RunListItem[]>('GET', '/api/runs'),
  getRun: (id: string) => request<RunDetail>('GET', `/api/runs/${encodeURIComponent(id)}`),
  saveRun: (name?: string) => request<{ id: string; name: string }>('POST', '/api/runs', { name }),
  deleteRun: (id: string) => request('DELETE', `/api/runs/${encodeURIComponent(id)}`),
  restoreRun: (id: string) => request('POST', `/api/runs/${encodeURIComponent(id)}/restore`),
  testJev: (ai?: DeepPartial<AppConfig['ai']>) => request<{ provider: string; health: { ok: boolean; latencyMs: number; message: string }; model: unknown; result: unknown }>('POST', '/api/jev/test', { ai }),
  listRobotConfigs: () => request<Array<{ id: string; name: string; createdAt: number }>>('GET', '/api/robot-configs'),
  saveRobotConfig: (name: string) => request('POST', '/api/robot-configs', { name }),
  applyRobotConfig: (id: string) => request('POST', `/api/robot-configs/${encodeURIComponent(id)}/apply`),
  deleteRobotConfig: (id: string) => request('DELETE', `/api/robot-configs/${encodeURIComponent(id)}`),
};
