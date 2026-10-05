/**
 * Minimal stand-in for a local Jev decision server, to exercise the LocalJevAdapter
 * end-to-end (HTTP, latency, errors) without the real model.
 *
 *   npm run mock-jev                       # http://localhost:8000 (native protocol)
 *   MOCK_JEV_PORT=8001 MOCK_JEV_LATENCY=150 npm run mock-jev
 *
 * Endpoints:
 *   GET  /health                 → {status, model, version}
 *   POST /decide                 → {action, confidence, reason}            (native)
 *   GET  /v1/models              → OpenAI-style model list
 *   POST /v1/chat/completions    → OpenAI-style chat completion with JSON content
 */
import { createServer } from 'node:http';
import type { AggregatedState } from '@rover/protocol';
import { MockDecisionEngine } from '@rover/decision-engine';

const port = Number(process.env.MOCK_JEV_PORT ?? 8000);
const latency = Number(process.env.MOCK_JEV_LATENCY ?? 120);
const jitter = Number(process.env.MOCK_JEV_JITTER ?? 60);
const errorRate = Number(process.env.MOCK_JEV_ERROR_RATE ?? 0);
const policy = new MockDecisionEngine();

const send = (res: import('node:http').ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};

createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    const delay = Math.max(0, latency + (Math.random() * 2 - 1) * jitter);
    setTimeout(() => {
      if (req.method === 'GET' && req.url === '/health') return send(res, 200, { status: 'ok', model: 'jev-mock-1', version: '0.1.0' });
      if (req.method === 'GET' && req.url === '/v1/models') return send(res, 200, { data: [{ id: 'jev-mock-1', object: 'model' }] });
      if (req.method !== 'POST') return send(res, 404, { error: 'not found' });
      if (Math.random() < errorRate) return send(res, 500, { error: 'simulated server error' });
      let body: { state?: AggregatedState; messages?: Array<{ content: string }> };
      try {
        body = JSON.parse(raw);
      } catch {
        return send(res, 400, { error: 'invalid JSON' });
      }
      if (req.url === '/decide') {
        if (!body.state) return send(res, 400, { error: 'missing state' });
        const d = policy.decideSync(body.state);
        return send(res, 200, { ...d, reason: `[jev-mock] ${d.reason}` });
      }
      if (req.url === '/v1/chat/completions') {
        const state = JSON.parse(body.messages?.[body.messages.length - 1]?.content ?? '{}') as AggregatedState;
        const d = policy.decideSync(state);
        return send(res, 200, { id: 'cmpl-mock', object: 'chat.completion', choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify(d) }, finish_reason: 'stop' }] });
      }
      send(res, 404, { error: 'not found' });
    }, delay);
  });
}).listen(port, () => console.log(`mock Jev server on http://localhost:${port} (latency ${latency}±${jitter} ms, error rate ${errorRate})`));
