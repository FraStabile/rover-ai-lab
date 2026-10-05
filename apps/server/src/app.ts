import { existsSync } from 'node:fs';
import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import websocket from '@fastify/websocket';
import type { AppConfig, ServerMessage } from '@rover/protocol';
import { RoverRuntime } from '@rover/runtime';
import { getPreset } from '@rover/simulation';
import { openDatabase, type DbHandle } from './db/client';
import { Repository } from './db/repository';
import { registerRoutes } from './routes';
import { WsHub } from './ws-hub';

export const VERSION = '0.1.0';

export interface AppOptions {
  config: AppConfig;
  databaseFile: string;
  webDist?: string;
  logger?: boolean;
  healthIntervalMs?: number;
}

export interface RoverApp {
  app: FastifyInstance;
  runtime: RoverRuntime;
  hub: WsHub;
  db: DbHandle;
  close(): Promise<void>;
}

export async function buildApp(opts: AppOptions): Promise<RoverApp> {
  const startedAt = Date.now();
  const runtime = new RoverRuntime({ config: opts.config, scenario: getPreset('SINGLE_OBSTACLE') });
  const db = openDatabase(opts.databaseFile);
  const repo = new Repository(db);
  const app = Fastify({ logger: opts.logger ? { level: 'info' } : false, bodyLimit: 10 * 1024 * 1024 });

  const hello = (): ServerMessage => ({
    type: 'hello',
    data: {
      config: runtime.config,
      scenario: runtime.scenario,
      mode: runtime.mode,
      devMode: runtime.devMode,
      status: runtime.status,
      recording: { active: runtime.status === 'RUNNING', frames: runtime.recorder.frameTotal, duration: runtime.recorder.duration },
      version: VERSION,
    },
  });
  const hub = new WsHub(runtime, hello);

  // Periodic AI link health check (never blocks the simulation).
  let checking = false;
  const refreshHealth = async () => {
    if (checking) return;
    if (runtime.config.ai.provider === 'mock') {
      runtime.autonomy.setHealth(true, 'mock');
      return;
    }
    checking = true;
    try {
      const h = await runtime.autonomy.getEngine().healthCheck();
      runtime.autonomy.setHealth(h.ok, h.message);
    } catch (err) {
      runtime.autonomy.setHealth(false, String(err));
    } finally {
      checking = false;
    }
  };
  const healthTimer = setInterval(() => void refreshHealth(), opts.healthIntervalMs ?? 3000);
  void refreshHealth();

  await app.register(cors, { origin: true });
  await app.register(websocket, { options: { maxPayload: 1024 * 1024 } });

  app.setErrorHandler((err: Error & { statusCode?: number }, _req, reply) => {
    runtime.logger.error('HttpServer', err.message);
    reply.code(err.statusCode && err.statusCode >= 400 ? err.statusCode : 500).send({ error: err.message });
  });

  app.register(async (instance) => {
    instance.get('/ws', { websocket: true }, (socket) => hub.handleConnection(socket));
  });

  registerRoutes(app, { runtime, repo, hub, baseConfig: structuredClone(opts.config), version: VERSION, startedAt, refreshHealth });

  if (opts.webDist && existsSync(opts.webDist)) {
    await app.register(fastifyStatic, { root: opts.webDist, wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api') || req.url.startsWith('/ws')) return reply.code(404).send({ error: 'not found' });
      return reply.sendFile('index.html');
    });
  }

  return {
    app,
    runtime,
    hub,
    db,
    async close() {
      clearInterval(healthTimer);
      runtime.dispose();
      hub.close();
      await app.close();
      db.close();
    },
  };
}
