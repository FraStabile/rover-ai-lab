import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDefaultConfig, type AiConfig } from '@rover/protocol';
import { CustomHttpAdapter, LocalJevAdapter, mapResponse, renderTemplate, resolveJevPath, unwrapProviderResponse } from '../src';
import { makeState } from '../../autonomy/test/fixtures';

type Handler = (req: IncomingMessage, body: string, res: ServerResponse) => void;
let server: Server;
let base = '';
let handler: Handler = (_q, _b, res) => res.end('{}');
let lastBody: unknown = null;

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      try {
        lastBody = body ? JSON.parse(body) : null;
      } catch {
        lastBody = body;
      }
      handler(req, body, res);
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

const json = (res: ServerResponse, v: unknown, status = 200) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(v));
};
const signal = () => AbortSignal.timeout(1000);

function aiConfig(patch: (a: AiConfig) => void = () => {}): () => AiConfig {
  const c = createDefaultConfig().ai;
  c.jev.baseUrl = base;
  c.jev.protocol = 'native';
  c.custom.url = `${base}/custom`;
  patch(c);
  return () => c;
}

describe('LocalJevAdapter · jevos systemone', () => {
  it('asks one choice question over the actions and maps the answer', async () => {
    handler = (req, _b, res) =>
      req.url === '/v1/systemone'
        ? json(res, {
            model: 'jevos-v4',
            answers: { action: { type: 'choice', choice: 'TURN_LEFT', probabilities: { TURN_LEFT: 0.62, FORWARD: 0.2, STOP: 0.18 }, confidence: 0.41 } },
            usage: { input_tokens: 300, output_tokens: 0 },
          })
        : json(res, {}, 404);
    const a = new LocalJevAdapter(aiConfig((c) => (c.jev.protocol = 'systemone')));
    const r = await a.decide(makeState(), { signal: signal() });
    expect(r.error).toBeUndefined();
    expect(r.decision).toMatchObject({ action: 'TURN_LEFT', confidence: 0.62, meta: { model: 'jevos-v4', protocol: 'systemone' } });
    expect(r.decision?.reason).toContain('confidence 0.41');
    const body = lastBody as { model: string; state: unknown; questions: { action: { type: string; instructions: string; criteria: Record<string, string> } } };
    expect(body.model).toBe('jev-latest');
    expect(body.state).toMatchObject({ robot: { x: 0 } });
    expect(body.questions.action.type).toBe('choice');
    expect(Object.keys(body.questions.action.criteria)).toEqual(expect.arrayContaining(['FORWARD', 'TURN_LEFT', 'STOP', 'REACH_TARGET']));
    expect(body.questions.action.instructions).toContain('Which action');
  });

  it('falls back to the most probable option and rejects unknown choices', async () => {
    const a = new LocalJevAdapter(aiConfig((c) => (c.jev.protocol = 'systemone')));
    handler = (_q, _b, res) => json(res, { answers: { action: { type: 'choice', probabilities: { STOP: 0.7, FORWARD: 0.3 } } } });
    expect((await a.decide(makeState(), { signal: signal() })).decision?.action).toBe('STOP');
    handler = (_q, _b, res) => json(res, { answers: { action: { type: 'choice', choice: 'JUMP', probabilities: { JUMP: 1 } } } });
    expect((await a.decide(makeState(), { signal: signal() })).error?.code).toBe('INVALID_DECISION');
  });

  it('uses the jevos default paths', () => {
    expect(resolveJevPath('systemone', '', 'decide')).toBe('/v1/systemone');
    expect(resolveJevPath('systemone', '/decide', 'decide')).toBe('/v1/systemone');
    expect(resolveJevPath('openai-chat', '/health', 'health')).toBe('/v1/models');
    expect(resolveJevPath('native', '/custom/path', 'decide')).toBe('/custom/path');
  });
});

describe('LocalJevAdapter', () => {
  it('posts the state and converts the answer to the internal schema', async () => {
    handler = (req, _b, res) => (req.url === '/decide' ? json(res, { action: 'TURN_LEFT', confidence: 0.91, reason: 'Obstacle detected in front' }) : json(res, {}, 404));
    const a = new LocalJevAdapter(aiConfig());
    const r = await a.decide(makeState(), { signal: signal() });
    expect(r.error).toBeUndefined();
    expect(r.decision).toMatchObject({ action: 'TURN_LEFT', confidence: 0.91, reason: 'Obstacle detected in front' });
    expect(lastBody).toMatchObject({ model: 'jev-latest', state: { robot: { x: 0 } }, allowed_actions: expect.arrayContaining(['FORWARD']) });
  });

  it('supports OpenAI-compatible chat completions', async () => {
    handler = (req, _b, res) =>
      req.url === '/v1/chat/completions' ? json(res, { choices: [{ message: { content: '```json\n{"action":"forward","confidence":0.7,"reason":"clear"}\n```' } }] }) : json(res, {}, 404);
    const a = new LocalJevAdapter(aiConfig((c) => (c.jev.protocol = 'openai-chat')));
    const r = await a.decide(makeState(), { signal: signal() });
    expect(r.decision?.action).toBe('FORWARD');
    expect((lastBody as { messages: unknown[] }).messages).toHaveLength(2);
  });

  it('reports invalid JSON, invalid decisions and HTTP errors', async () => {
    const a = new LocalJevAdapter(aiConfig());
    handler = (_q, _b, res) => res.end('not json at all');
    expect((await a.decide(makeState(), { signal: signal() })).error?.code).toBe('INVALID_JSON');
    handler = (_q, _b, res) => json(res, { action: 'DANCE' });
    expect((await a.decide(makeState(), { signal: signal() })).error?.code).toBe('INVALID_DECISION');
    handler = (_q, _b, res) => json(res, { error: 'boom' }, 500);
    expect((await a.decide(makeState(), { signal: signal() })).error?.code).toBe('HTTP_ERROR');
  });

  it('times out via the abort signal', async () => {
    handler = () => {}; // never answers
    const a = new LocalJevAdapter(aiConfig());
    const r = await a.decide(makeState(), { signal: AbortSignal.timeout(100) });
    expect(r.error?.code).toBe('TIMEOUT');
  });

  it('reports an offline server', async () => {
    const a = new LocalJevAdapter(aiConfig((c) => (c.jev.baseUrl = 'http://127.0.0.1:1')));
    const r = await a.decide(makeState(), { signal: signal() });
    expect(r.error?.code).toBe('NETWORK');
    expect((await a.healthCheck()).ok).toBe(false);
  });

  it('health check hits the configured path', async () => {
    handler = (req, _b, res) => (req.url === '/health' ? json(res, { status: 'ok', model: 'jev-mini' }) : json(res, {}, 404));
    const a = new LocalJevAdapter(aiConfig());
    expect((await a.healthCheck()).ok).toBe(true);
    expect(a.getModelInfo().model).toBe('jev-mini');
  });

  it('unwraps common provider shapes', () => {
    expect(unwrapProviderResponse({ decision: { action: 'STOP' } })).toEqual({ action: 'STOP' });
    expect(unwrapProviderResponse({ response: '{"action":"STOP"}' })).toEqual({ action: 'STOP' });
  });
});

describe('CustomHttpAdapter', () => {
  it('renders the request template and applies response mapping + action map', async () => {
    handler = (_q, _b, res) => json(res, { result: { move: 'left', score: 0.8, why: 'wall' } });
    const a = new CustomHttpAdapter(
      aiConfig((c) => {
        c.custom.requestTemplate = JSON.stringify({ x: '{{state.robot.x}}', obs: '{{state.obstacles}}', label: 'front={{state.obstacles.front}}' });
        c.custom.responseMapping = { action: 'result.move', confidence: 'result.score', reason: 'result.why' };
        c.custom.actionMap = { left: 'TURN_LEFT' };
      }),
    );
    const r = await a.decide(makeState(), { signal: signal() });
    expect(r.decision).toMatchObject({ action: 'TURN_LEFT', confidence: 0.8, reason: 'wall' });
    expect(lastBody).toMatchObject({ x: 0, obs: { front: 9 }, label: 'front=9' });
  });

  it('template helpers', () => {
    expect(renderTemplate('{"a":"{{model}}"}', { model: 'm' })).toEqual({ a: 'm' });
    expect(mapResponse({ choices: [{ message: { content: '{"action":"STOP"}' } }] }, { action: 'choices.0.message.content', confidence: '', reason: '' })).toEqual({ action: 'STOP' });
  });
});
