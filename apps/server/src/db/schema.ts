import { integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const scenarios = sqliteTable('scenarios', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  data: text('data', { mode: 'json' }).notNull(),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const robotConfigurations = sqliteTable('robot_configurations', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  data: text('data', { mode: 'json' }).notNull(),
  createdAt: integer('created_at').notNull(),
});

export const simulationRuns = sqliteTable('simulation_runs', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  scenarioId: text('scenario_id'),
  scenarioName: text('scenario_name').notNull(),
  provider: text('provider').notNull(),
  seed: integer('seed').notNull(),
  duration: real('duration').notNull(),
  summary: text('summary', { mode: 'json' }).notNull(),
  config: text('config', { mode: 'json' }).notNull(),
  scenario: text('scenario', { mode: 'json' }).notNull(),
  createdAt: integer('created_at').notNull(),
});

/** Events and telemetry frames (type = TELEMETRY_FRAME) needed for replay. */
export const simulationEvents = sqliteTable('simulation_events', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  runId: text('run_id').notNull(),
  simTime: real('sim_time').notNull(),
  timestamp: integer('timestamp').notNull(),
  type: text('type').notNull(),
  category: text('category').notNull(),
  level: text('level').notNull(),
  source: text('source').notNull(),
  message: text('message').notNull(),
  payload: text('payload', { mode: 'json' }),
});

export const aiRequests = sqliteTable('ai_requests', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  runId: text('run_id').notNull(),
  requestId: integer('request_id').notNull(),
  simTime: real('sim_time').notNull(),
  provider: text('provider').notNull(),
  model: text('model').notNull(),
  state: text('state', { mode: 'json' }).notNull(),
  request: text('request', { mode: 'json' }),
  timestamp: integer('timestamp').notNull(),
});

export const aiResponses = sqliteTable('ai_responses', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  runId: text('run_id').notNull(),
  requestId: integer('request_id').notNull(),
  simTime: real('sim_time').notNull(),
  latencyMs: real('latency_ms').notNull(),
  injectedLatencyMs: real('injected_latency_ms').notNull(),
  decision: text('decision', { mode: 'json' }),
  error: text('error', { mode: 'json' }),
  response: text('response', { mode: 'json' }),
});

export const MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS scenarios (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', data TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS robot_configurations (id TEXT PRIMARY KEY, name TEXT NOT NULL, data TEXT NOT NULL, created_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS simulation_runs (id TEXT PRIMARY KEY, name TEXT NOT NULL, scenario_id TEXT, scenario_name TEXT NOT NULL, provider TEXT NOT NULL, seed INTEGER NOT NULL, duration REAL NOT NULL, summary TEXT NOT NULL, config TEXT NOT NULL, scenario TEXT NOT NULL, created_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS simulation_events (id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL, sim_time REAL NOT NULL, timestamp INTEGER NOT NULL, type TEXT NOT NULL, category TEXT NOT NULL, level TEXT NOT NULL, source TEXT NOT NULL, message TEXT NOT NULL, payload TEXT)`,
  `CREATE INDEX IF NOT EXISTS idx_events_run ON simulation_events(run_id, sim_time)`,
  `CREATE TABLE IF NOT EXISTS ai_requests (id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL, request_id INTEGER NOT NULL, sim_time REAL NOT NULL, provider TEXT NOT NULL, model TEXT NOT NULL, state TEXT NOT NULL, request TEXT, timestamp INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_ai_requests_run ON ai_requests(run_id)`,
  `CREATE TABLE IF NOT EXISTS ai_responses (id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL, request_id INTEGER NOT NULL, sim_time REAL NOT NULL, latency_ms REAL NOT NULL, injected_latency_ms REAL NOT NULL, decision TEXT, error TEXT, response TEXT)`,
  `CREATE INDEX IF NOT EXISTS idx_ai_responses_run ON ai_responses(run_id)`,
];
