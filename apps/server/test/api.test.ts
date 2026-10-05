import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDefaultConfig } from '@rover/protocol';
import { buildApp, type RoverApp } from '../src/app';

let rover: RoverApp;

beforeAll(async () => {
  rover = await buildApp({ config: createDefaultConfig(), databaseFile: ':memory:', healthIntervalMs: 60_000 });
});
afterAll(async () => rover.close());

const inject = (method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, payload?: unknown) =>
  rover.app.inject({ method, url, payload: payload as Record<string, unknown> | undefined });

describe('REST API', () => {
  it('GET /api/health', async () => {
    const r = await inject('GET', '/api/health');
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ ok: true, database: 'ok', ai: { provider: 'mock' } });
  });

  it('GET /api/topics lists the virtual ROS2 graph', async () => {
    const names = (await inject('GET', '/api/topics')).json().map((t: { name: string }) => t.name);
    for (const t of ['/scan', '/imu', '/odom', '/gps', '/motor_state', '/battery', '/cmd_vel', '/mission', '/decision']) expect(names).toContain(t);
  });

  it('PATCH /api/config updates parameters live and ignores unknown keys', async () => {
    const r = await inject('PATCH', '/api/config', { robot: { maxSpeed: 1.5 }, bogus: 1, ai: { decisionIntervalMs: 250 } });
    expect(r.statusCode).toBe(200);
    expect(r.json().changed).toEqual(['robot.maxSpeed', 'ai.decisionIntervalMs']);
    expect((await inject('GET', '/api/config')).json().robot.maxSpeed).toBe(1.5);
  });

  it('controls the simulation and records a run', async () => {
    expect((await inject('POST', '/api/sim/mode', { mode: 'AUTO' })).json().mode).toBe('AUTO');
    const step = await inject('POST', '/api/sim/control', { action: 'step', steps: 250 });
    expect(step.json().simTime).toBeCloseTo(5, 5);
    const robot = (await inject('GET', '/api/robot')).json();
    expect(robot.frame.pose.x).toBeGreaterThan(4);
    const saved = await inject('POST', '/api/runs', { name: 'test run' });
    expect(saved.statusCode).toBe(200);
    const id = saved.json().id;
    const list = (await inject('GET', '/api/runs')).json();
    expect(list[0]).toMatchObject({ id, name: 'test run', provider: 'mock' });
    const run = (await inject('GET', `/api/runs/${id}`)).json();
    expect(run.frames.length).toBeGreaterThan(40);
    expect(run.events.length).toBeGreaterThan(5);
    expect(run.exchanges.length).toBeGreaterThan(5);
    expect(run.exchanges[0].state.robot).toBeDefined();
    expect((await inject('DELETE', `/api/runs/${id}`)).statusCode).toBe(200);
    expect((await inject('GET', `/api/runs/${id}`)).statusCode).toBe(404);
  });

  it('scenario CRUD and validation', async () => {
    const presets = (await inject('GET', '/api/scenarios')).json().presets;
    expect(presets.length).toBe(10);
    const custom = { ...presets[0], id: '', name: 'My field', builtIn: false };
    const created = (await inject('POST', '/api/scenarios', custom)).json();
    expect(created.id).toMatch(/^scn-/);
    expect((await inject('GET', `/api/scenarios/${created.id}`)).json().name).toBe('My field');
    expect((await inject('POST', '/api/scenarios', { name: '' })).statusCode).toBe(400);
    expect((await inject('PUT', '/api/sim/scenario', created)).json().name).toBe('My field');
    expect((await inject('DELETE', `/api/scenarios/${created.id}`)).statusCode).toBe(200);
  });

  it('generates deterministic random scenarios', async () => {
    const a = (await inject('POST', '/api/scenarios/generate', { seed: 5, numberOfObstacles: 10 })).json();
    const b = (await inject('POST', '/api/scenarios/generate', { seed: 5, numberOfObstacles: 10 })).json();
    expect(a.scenario).toEqual(b.scenario);
  });

  it('POST /api/jev/test reports an offline endpoint without throwing', async () => {
    const r = await inject('POST', '/api/jev/test', { ai: { provider: 'local-jev', timeoutMs: 200, jev: { baseUrl: 'http://127.0.0.1:1' } } });
    expect(r.statusCode).toBe(200);
    expect(r.json().health.ok).toBe(false);
    expect(r.json().result.error.code).toBe('NETWORK');
  });

  it('rejects invalid input', async () => {
    expect((await inject('POST', '/api/sim/mode', { mode: 'FLY' })).statusCode).toBe(400);
    expect((await inject('POST', '/api/sim/control', { action: 'explode' })).statusCode).toBe(400);
  });
});
