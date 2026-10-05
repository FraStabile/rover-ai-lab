/**
 * Stand-in for a local jevos / Jev server, to exercise the LocalJevAdapter end-to-end
 * (HTTP, latency, errors) without downloading the real model. It listens where jevos does,
 * so it is a drop-in replacement: `npm run mock-jev` instead of `npm run jev`.
 *
 *   npm run mock-jev                                   # http://127.0.0.1:8017
 *   MOCK_JEV_PORT=8001 MOCK_JEV_LATENCY=150 npm run mock-jev
 *
 * Endpoints:
 *   GET  /health                 → {status: "ready", model, version}
 *   POST /v1/systemone           → jevos answer to a `choice` question             (systemone)
 *   POST /decide                 → {action, confidence, reason}                    (native)
 *   GET  /v1/models              → model list
 *   POST /v1/chat/completions    → OpenAI-style chat completion with JSON content  (openai-chat)
 */
import { createServer } from 'node:http';
import type { AggregatedState } from '@rover/protocol';
import { MockDecisionEngine } from '@rover/decision-engine';

const port = Number(process.env.MOCK_JEV_PORT ?? 8017);
const host = process.env.MOCK_JEV_HOST ?? '127.0.0.1';
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
      if (req.method === 'GET' && req.url === '/health') return send(res, 200, { status: 'ready', model: 'jev-mock-1', version: '0.2.0' });
      if (req.method === 'GET' && req.url === '/v1/models') return send(res, 200, { data: [{ id: 'jev-mock-1', object: 'model' }, { id: 'jev-latest', object: 'model' }] });
      if (req.method !== 'POST') return send(res, 404, { error: 'not found' });
      if (Math.random() < errorRate) return send(res, 500, { error: 'simulated server error' });
      let body: {
        state?: AggregatedState;
        messages?: Array<{ content: string }>;
        questions?: Record<string, { type: string; criteria?: Record<string, string> | string[] }>;
      };
      try {
        body = JSON.parse(raw);
      } catch {
        return send(res, 400, { error: 'invalid JSON' });
      }
      if (req.url === '/v1/systemone') {
        if (!body.state || !body.questions) return send(res, 400, { error: 'state and questions are required' });
        const d = policy.decideSync(body.state);
        const answers: Record<string, unknown> = {};
        for (const [name, q] of Object.entries(body.questions)) {
          if (q.type !== 'choice' || !q.criteria) {
            answers[name] = { type: 'noul', noul: 0.5 };
            continue;
          }
          const options = Array.isArray(q.criteria) ? q.criteria : Object.keys(q.criteria);
          // Put most of the mass on the policy's choice, the rest spread evenly.
          const peak = 0.55 + 0.4 * d.confidence;
          const rest = options.length > 1 ? (1 - peak) / (options.length - 1) : 0;
          const probabilities = Object.fromEntries(options.map((o) => [o, +(o === d.action ? peak : rest).toFixed(4)]));
          const confidence = options.length > 1 ? +((peak - 1 / options.length) / (1 - 1 / options.length)).toFixed(4) : 1;
          answers[name] = { type: 'choice', choice: d.action, probabilities, confidence };
        }
        return send(res, 200, { model: 'jev-mock-1', answers, usage: { input_tokens: raw.length >> 2, output_tokens: 0 } });
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
}).listen(port, host, () => console.log(`mock Jev server on http://${host}:${port} (latency ${latency}±${jitter} ms, error rate ${errorRate})`));
