import type { DecisionErrorCode } from '@rover/protocol';

export interface HttpResult {
  ok: boolean;
  status: number;
  body: unknown;
  text: string;
  latencyMs: number;
  error?: { code: DecisionErrorCode; message: string };
}

/** fetch wrapper that never throws and classifies failures. */
export async function httpRequest(
  url: string,
  init: { method: string; headers?: Record<string, string>; body?: unknown; signal?: AbortSignal },
): Promise<HttpResult> {
  const started = Date.now();
  try {
    const res = await fetch(url, {
      method: init.method,
      headers: init.body !== undefined ? { 'content-type': 'application/json', ...init.headers } : init.headers,
      body: init.body !== undefined && init.method !== 'GET' ? JSON.stringify(init.body) : undefined,
      signal: init.signal,
    });
    const text = await res.text();
    const latencyMs = Date.now() - started;
    let body: unknown = text;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    if (!res.ok) {
      return { ok: false, status: res.status, body, text, latencyMs, error: { code: 'HTTP_ERROR', message: `HTTP ${res.status} ${res.statusText}` } };
    }
    return { ok: true, status: res.status, body, text, latencyMs };
  } catch (err) {
    const latencyMs = Date.now() - started;
    const aborted = init.signal?.aborted || (err instanceof Error && err.name === 'AbortError');
    const message = err instanceof Error ? ((err as Error & { cause?: { code?: string } }).cause?.code ?? err.message) : String(err);
    return {
      ok: false,
      status: 0,
      body: null,
      text: '',
      latencyMs,
      error: aborted ? { code: 'TIMEOUT', message: 'request aborted (timeout)' } : { code: 'NETWORK', message },
    };
  }
}

export function joinUrl(base: string, path: string): string {
  if (!path) return base;
  if (/^https?:\/\//i.test(path)) return path;
  return `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

export function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}
