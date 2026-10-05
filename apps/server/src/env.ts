import { existsSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDefaultConfig, type AiProvider, type AppConfig } from '@rover/protocol';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

export interface ServerEnv {
  port: number;
  host: string;
  databaseFile: string;
  production: boolean;
  webDist: string;
}

function loadDotEnv(): void {
  const file = resolve(REPO_ROOT, '.env');
  if (existsSync(file)) {
    try {
      process.loadEnvFile(file);
    } catch {
      // ignore malformed .env
    }
  }
}

const num = (v: string | undefined, fallback: number) => {
  const n = v === undefined || v === '' ? NaN : Number(v);
  return Number.isFinite(n) ? n : fallback;
};

const bool = (v: string | undefined, fallback: boolean) => (v === undefined || v === '' ? fallback : /^(1|true|yes|on)$/i.test(v));

export function readEnv(): ServerEnv {
  loadDotEnv();
  const production = process.env.NODE_ENV === 'production';
  const dbUrl = process.env.DATABASE_URL ?? 'file:./data/rover.db';
  const raw = dbUrl.replace(/^file:/, '');
  const databaseFile = raw === ':memory:' ? raw : isAbsolute(raw) ? raw : resolve(REPO_ROOT, raw);
  return {
    // In development the UI (Vite) owns :3000 and proxies to the API on API_PORT.
    port: production ? num(process.env.PORT ?? process.env.API_PORT, 3000) : num(process.env.API_PORT, 3001),
    host: process.env.HOST ?? '0.0.0.0',
    databaseFile,
    production,
    webDist: resolve(REPO_ROOT, 'apps/web/dist'),
  };
}

/** Builds the initial AppConfig from defaults + environment variables. */
export function configFromEnv(): AppConfig {
  const cfg = createDefaultConfig();
  const e = process.env;
  const provider = (e.AI_PROVIDER ?? '') as AiProvider;
  const jevEnabled = bool(e.JEV_ENABLED, false);
  if (provider === 'mock' || provider === 'local-jev' || provider === 'custom-http') cfg.ai.provider = provider;
  else if (jevEnabled) cfg.ai.provider = 'local-jev';
  cfg.ai.jev.enabled = jevEnabled || cfg.ai.provider === 'local-jev';
  cfg.ai.jev.baseUrl = e.JEV_BASE_URL ?? e.JEV_URL ?? cfg.ai.jev.baseUrl;
  cfg.ai.jev.model = e.JEV_MODEL ?? cfg.ai.jev.model;
  cfg.ai.timeoutMs = num(e.JEV_TIMEOUT, cfg.ai.timeoutMs);
  if (e.JEV_PROTOCOL === 'openai-chat' || e.JEV_PROTOCOL === 'native' || e.JEV_PROTOCOL === 'systemone') cfg.ai.jev.protocol = e.JEV_PROTOCOL;
  if (e.JEV_INSTRUCTIONS) cfg.ai.jev.instructions = e.JEV_INSTRUCTIONS;
  cfg.ai.jev.decidePath = e.JEV_DECIDE_PATH ?? cfg.ai.jev.decidePath;
  cfg.ai.jev.healthPath = e.JEV_HEALTH_PATH ?? cfg.ai.jev.healthPath;
  if (e.CUSTOM_AI_URL) cfg.ai.custom.url = e.CUSTOM_AI_URL;
  cfg.simulation.hz = num(e.SIMULATION_DEFAULT_HZ, cfg.simulation.hz);
  cfg.simulation.seed = num(e.SIMULATION_SEED, cfg.simulation.seed);
  return cfg;
}
