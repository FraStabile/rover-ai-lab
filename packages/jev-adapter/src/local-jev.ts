import type { AggregatedState, AiConfig, DecisionResult, HealthStatus, ModelInfo } from '@rover/protocol';
import { extractJsonObject, validateDecision, type DecideOptions, type DecisionEngine } from '@rover/decision-engine';
import { isPlainObject } from '@rover/shared';
import { httpRequest, joinUrl } from './http';
import { chatRequestBody, nativeRequestBody, resolveJevPath, systemoneRequestBody } from './prompt';

/**
 * Pulls a decision-like object out of the many shapes local model servers return:
 * {action…}, {decision:{…}}, {output|response|text: "json"}, OpenAI {choices:[{message:{content}}]}.
 */
export function unwrapProviderResponse(body: unknown): unknown {
  if (typeof body === 'string') return extractJsonObject(body);
  if (!isPlainObject(body)) return body;
  if ('action' in body) return body;
  if (isPlainObject(body.answers)) return unwrapSystemone(body);
  if (isPlainObject(body.decision)) return body.decision;
  const choices = body.choices;
  if (Array.isArray(choices) && choices.length > 0) {
    const c = choices[0] as Record<string, unknown>;
    const content = isPlainObject(c.message) ? c.message.content : c.text;
    if (typeof content === 'string') return extractJsonObject(content);
  }
  for (const key of ['output', 'response', 'text', 'content', 'result']) {
    const v = body[key];
    if (typeof v === 'string') return extractJsonObject(v);
    if (isPlainObject(v)) return unwrapProviderResponse(v);
  }
  return body;
}

/**
 * jevos / Jev systemone answer → decision-like object.
 * {"answers": {"action": {"type":"choice","choice":"TURN_LEFT","probabilities":{…},"confidence":0.41}}}
 * The decision confidence is the probability of the chosen option; Jev's own `confidence`
 * (peak probability rescaled from uniform) is kept in the reason and meta.
 */
export function unwrapSystemone(body: Record<string, unknown>): unknown {
  const answers = body.answers as Record<string, unknown>;
  const a = (isPlainObject(answers.action) ? answers.action : Object.values(answers).find(isPlainObject)) as Record<string, unknown> | undefined;
  if (!a) return undefined;
  const probs = isPlainObject(a.probabilities) ? (a.probabilities as Record<string, number>) : {};
  let choice = typeof a.choice === 'string' ? a.choice : undefined;
  if (!choice && Object.keys(probs).length) choice = Object.entries(probs).sort((x, y) => y[1] - x[1])[0][0];
  if (!choice) return { action: undefined };
  const p = typeof probs[choice] === 'number' ? probs[choice] : typeof a.confidence === 'number' ? a.confidence : 0.5;
  const jevConf = typeof a.confidence === 'number' ? a.confidence : null;
  const top = Object.entries(probs)
    .sort((x, y) => y[1] - x[1])
    .slice(0, 3)
    .map(([k, v]) => `${k} ${v.toFixed(2)}`)
    .join(', ');
  return {
    action: choice,
    confidence: p,
    reason: `jevos choice${jevConf !== null ? ` (confidence ${jevConf.toFixed(2)})` : ''}${top ? `: ${top}` : ''}`,
  };
}

/**
 * jevos requires `Authorization: Bearer <key>` on every call but /health when it runs with JEV_API_KEY.
 * The key is read from the environment at call time, never stored in the config (which is sent to the
 * UI and saved with recorded runs).
 */
function withApiKey(headers: Record<string, string>): Record<string, string> {
  const key = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.JEV_API_KEY;
  return key && !Object.keys(headers).some((h) => h.toLowerCase() === 'authorization') ? { ...headers, authorization: `Bearer ${key}` } : headers;
}

/** DecisionEngine backed by a locally hosted Jev / Jev-like model over HTTP. */
export class LocalJevAdapter implements DecisionEngine {
  readonly id = 'local-jev';
  private remoteInfo: Record<string, unknown> | null = null;

  constructor(private readonly config: () => AiConfig) {}

  private get decideUrl(): string {
    const j = this.config().jev;
    return joinUrl(j.baseUrl, resolveJevPath(j.protocol, j.decidePath, 'decide'));
  }

  private get healthUrl(): string {
    const j = this.config().jev;
    return joinUrl(j.baseUrl, resolveJevPath(j.protocol, j.healthPath, 'health'));
  }

  async decide(state: AggregatedState, opts: DecideOptions): Promise<DecisionResult> {
    const j = this.config().jev;
    const body =
      j.protocol === 'systemone'
        ? systemoneRequestBody(j.model, state, j.instructions)
        : j.protocol === 'openai-chat'
          ? chatRequestBody(j.model, state, j.temperature)
          : nativeRequestBody(j.model, state);
    const res = await httpRequest(this.decideUrl, { method: 'POST', headers: withApiKey(j.headers), body, signal: opts.signal });
    const raw = { request: { url: this.decideUrl, body }, response: res.body };
    if (res.error) return { decision: null, latencyMs: res.latencyMs, error: res.error, raw };
    const candidate = unwrapProviderResponse(res.body);
    if (candidate === undefined) {
      return { decision: null, latencyMs: res.latencyMs, error: { code: 'INVALID_JSON', message: 'response is not valid JSON' }, raw };
    }
    const v = validateDecision(candidate);
    if (!v.ok) return { decision: null, latencyMs: res.latencyMs, error: { code: 'INVALID_DECISION', message: v.error }, raw };
    const served = isPlainObject(res.body) && typeof res.body.model === 'string' ? res.body.model : j.model;
    return { decision: { ...v.decision, meta: { provider: 'local-jev', model: served, protocol: j.protocol } }, latencyMs: res.latencyMs, raw };
  }

  async healthCheck(signal?: AbortSignal): Promise<HealthStatus> {
    const j = this.config().jev;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), Math.max(500, this.config().timeoutMs * 2));
    signal?.addEventListener('abort', () => ctrl.abort(), { once: true });
    const res = await httpRequest(this.healthUrl, { method: 'GET', headers: withApiKey(j.headers), signal: ctrl.signal });
    clearTimeout(timer);
    if (res.ok && isPlainObject(res.body)) this.remoteInfo = res.body;
    return {
      ok: res.ok,
      latencyMs: res.latencyMs,
      message: res.ok ? `HTTP ${res.status} from ${this.healthUrl}` : `${res.error?.code}: ${res.error?.message} (${this.healthUrl})`,
    };
  }

  getModelInfo(): ModelInfo {
    const j = this.config().jev;
    const info = this.remoteInfo ?? {};
    return {
      provider: 'local-jev',
      model: typeof info.model === 'string' ? info.model : j.model,
      endpoint: this.decideUrl,
      version: typeof info.version === 'string' ? info.version : undefined,
      description: j.protocol === 'systemone' ? 'jevos / Jev systemone (choice question)' : j.protocol === 'openai-chat' ? 'OpenAI-compatible chat completions' : 'Native JSON decision endpoint',
    };
  }
}
