import type { AggregatedState, AiConfig, DecisionResult, HealthStatus, ModelInfo } from '@rover/protocol';
import { extractJsonObject, validateDecision, type DecideOptions, type DecisionEngine } from '@rover/decision-engine';
import { isPlainObject } from '@rover/shared';
import { httpRequest, joinUrl } from './http';
import { chatRequestBody, nativeRequestBody } from './prompt';

/**
 * Pulls a decision-like object out of the many shapes local model servers return:
 * {action…}, {decision:{…}}, {output|response|text: "json"}, OpenAI {choices:[{message:{content}}]}.
 */
export function unwrapProviderResponse(body: unknown): unknown {
  if (typeof body === 'string') return extractJsonObject(body);
  if (!isPlainObject(body)) return body;
  if ('action' in body) return body;
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

/** DecisionEngine backed by a locally hosted Jev / Jev-like model over HTTP. */
export class LocalJevAdapter implements DecisionEngine {
  readonly id = 'local-jev';
  private remoteInfo: Record<string, unknown> | null = null;

  constructor(private readonly config: () => AiConfig) {}

  private get decideUrl(): string {
    const j = this.config().jev;
    const path = j.protocol === 'openai-chat' && (j.decidePath === '/decide' || !j.decidePath) ? '/v1/chat/completions' : j.decidePath;
    return joinUrl(j.baseUrl, path);
  }

  private get healthUrl(): string {
    const j = this.config().jev;
    const path = j.protocol === 'openai-chat' && (j.healthPath === '/health' || !j.healthPath) ? '/v1/models' : j.healthPath;
    return joinUrl(j.baseUrl, path);
  }

  async decide(state: AggregatedState, opts: DecideOptions): Promise<DecisionResult> {
    const j = this.config().jev;
    const body = j.protocol === 'openai-chat' ? chatRequestBody(j.model, state, j.temperature) : nativeRequestBody(j.model, state);
    const res = await httpRequest(this.decideUrl, { method: 'POST', headers: j.headers, body, signal: opts.signal });
    const raw = { request: { url: this.decideUrl, body }, response: res.body };
    if (res.error) return { decision: null, latencyMs: res.latencyMs, error: res.error, raw };
    const candidate = unwrapProviderResponse(res.body);
    if (candidate === undefined) {
      return { decision: null, latencyMs: res.latencyMs, error: { code: 'INVALID_JSON', message: 'response is not valid JSON' }, raw };
    }
    const v = validateDecision(candidate);
    if (!v.ok) return { decision: null, latencyMs: res.latencyMs, error: { code: 'INVALID_DECISION', message: v.error }, raw };
    return { decision: { ...v.decision, meta: { provider: 'local-jev', model: j.model } }, latencyMs: res.latencyMs, raw };
  }

  async healthCheck(signal?: AbortSignal): Promise<HealthStatus> {
    const j = this.config().jev;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), Math.max(500, this.config().timeoutMs * 2));
    signal?.addEventListener('abort', () => ctrl.abort(), { once: true });
    const res = await httpRequest(this.healthUrl, { method: 'GET', headers: j.headers, signal: ctrl.signal });
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
      description: j.protocol === 'openai-chat' ? 'OpenAI-compatible chat completions' : 'Native JSON decision endpoint',
    };
  }
}
