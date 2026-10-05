import { AI_ACTIONS, type AggregatedState, type AiConfig, type DecisionResult, type HealthStatus, type ModelInfo } from '@rover/protocol';
import { extractJsonObject, validateDecision, type DecideOptions, type DecisionEngine } from '@rover/decision-engine';
import { getPath, isPlainObject } from '@rover/shared';
import { httpRequest, isHttpUrl } from './http';

const WHOLE = /^\{\{\s*([\w.]+)\s*\}\}$/;
const INLINE = /\{\{\s*([\w.]+)\s*\}\}/g;

function resolvePlaceholder(name: string, ctx: Record<string, unknown>): unknown {
  return getPath(ctx, name);
}

function renderValue(v: unknown, ctx: Record<string, unknown>): unknown {
  if (typeof v === 'string') {
    const whole = WHOLE.exec(v);
    if (whole) return resolvePlaceholder(whole[1], ctx);
    return v.replace(INLINE, (_, name: string) => {
      const r = resolvePlaceholder(name, ctx);
      return typeof r === 'string' ? r : JSON.stringify(r);
    });
  }
  if (Array.isArray(v)) return v.map((x) => renderValue(x, ctx));
  if (isPlainObject(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, renderValue(x, ctx)]));
  return v;
}

/** Renders a JSON request template with {{state}}, {{model}}, {{actions}} and {{state.path}} placeholders. */
export function renderTemplate(template: string, ctx: Record<string, unknown>): unknown {
  try {
    return renderValue(JSON.parse(template), ctx);
  } catch {
    return template.replace(INLINE, (_, name: string) => JSON.stringify(resolvePlaceholder(name, ctx)));
  }
}

/** Applies the configured response mapping (dotted paths) to a provider response. */
export function mapResponse(body: unknown, mapping: { action: string; confidence: string; reason: string }): Record<string, unknown> {
  let action = getPath(body, mapping.action);
  // Mapping may point at a JSON string (e.g. choices.0.message.content).
  if (typeof action === 'string') {
    const parsed = extractJsonObject(action);
    if (isPlainObject(parsed) && 'action' in parsed) return parsed;
  }
  if (isPlainObject(action) && 'action' in action) return action;
  if (action === undefined && isPlainObject(body)) action = body.action;
  return {
    action,
    confidence: mapping.confidence ? getPath(body, mapping.confidence) : undefined,
    reason: mapping.reason ? getPath(body, mapping.reason) : undefined,
  };
}

/** Fully configurable HTTP decision provider (any model server, Python service, proprietary API…). */
export class CustomHttpAdapter implements DecisionEngine {
  readonly id = 'custom-http';

  constructor(private readonly config: () => AiConfig) {}

  async decide(state: AggregatedState, opts: DecideOptions): Promise<DecisionResult> {
    const c = this.config().custom;
    if (!isHttpUrl(c.url)) return { decision: null, latencyMs: 0, error: { code: 'ENGINE_ERROR', message: `invalid URL: ${c.url}` } };
    const ctx = { state, model: this.config().jev.model, actions: AI_ACTIONS };
    const body = c.method === 'GET' ? undefined : renderTemplate(c.requestTemplate, ctx);
    const res = await httpRequest(c.url, { method: c.method, headers: c.headers, body, signal: opts.signal });
    const raw = { request: { url: c.url, method: c.method, body }, response: res.body };
    if (res.error) return { decision: null, latencyMs: res.latencyMs, error: res.error, raw };
    const parsed = typeof res.body === 'string' ? extractJsonObject(res.body) : res.body;
    if (parsed === undefined) return { decision: null, latencyMs: res.latencyMs, error: { code: 'INVALID_JSON', message: 'response is not JSON' }, raw };
    const v = validateDecision(mapResponse(parsed, c.responseMapping), c.actionMap);
    if (!v.ok) return { decision: null, latencyMs: res.latencyMs, error: { code: 'INVALID_DECISION', message: v.error }, raw };
    return { decision: { ...v.decision, meta: { provider: 'custom-http' } }, latencyMs: res.latencyMs, raw };
  }

  async healthCheck(signal?: AbortSignal): Promise<HealthStatus> {
    const c = this.config().custom;
    const url = c.healthUrl || c.url;
    if (!isHttpUrl(url)) return { ok: false, latencyMs: 0, message: `invalid URL: ${url}` };
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), Math.max(500, this.config().timeoutMs * 2));
    signal?.addEventListener('abort', () => ctrl.abort(), { once: true });
    const res = await httpRequest(url, { method: c.healthUrl ? 'GET' : 'OPTIONS', headers: c.headers, signal: ctrl.signal });
    clearTimeout(timer);
    // Any HTTP answer (even 404/405) proves the server is reachable.
    const reachable = res.status > 0;
    return { ok: reachable, latencyMs: res.latencyMs, message: reachable ? `HTTP ${res.status} from ${url}` : `${res.error?.code}: ${res.error?.message}` };
  }

  getModelInfo(): ModelInfo {
    const c = this.config().custom;
    return { provider: 'custom-http', model: this.config().jev.model, endpoint: `${c.method} ${c.url}`, description: 'User-defined HTTP mapping' };
  }
}
