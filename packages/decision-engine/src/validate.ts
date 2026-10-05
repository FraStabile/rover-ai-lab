import { AI_ACTIONS, type AiAction, type Decision } from '@rover/protocol';

const ALIASES: Record<string, AiAction> = {
  FORWARD: 'FORWARD',
  GO: 'FORWARD',
  AHEAD: 'FORWARD',
  MOVE_FORWARD: 'FORWARD',
  LEFT: 'TURN_LEFT',
  TURN_LEFT: 'TURN_LEFT',
  RIGHT: 'TURN_RIGHT',
  TURN_RIGHT: 'TURN_RIGHT',
  BACK: 'REVERSE',
  BACKWARD: 'REVERSE',
  REVERSE: 'REVERSE',
  STOP: 'STOP',
  HALT: 'STOP',
  SLOW: 'SLOW_DOWN',
  SLOW_DOWN: 'SLOW_DOWN',
  REACH_TARGET: 'REACH_TARGET',
  GO_TO_TARGET: 'REACH_TARGET',
  NAVIGATE: 'REACH_TARGET',
  RETURN_HOME: 'RETURN_HOME',
  HOME: 'RETURN_HOME',
};

export function normalizeAction(value: unknown, actionMap: Record<string, string> = {}): AiAction | null {
  if (typeof value !== 'string') return null;
  const mapped = actionMap[value] ?? actionMap[value.toLowerCase()] ?? value;
  const key = mapped.trim().toUpperCase().replace(/[\s-]+/g, '_');
  if ((AI_ACTIONS as readonly string[]).includes(key)) return key as AiAction;
  return ALIASES[key] ?? null;
}

export type ValidationResult = { ok: true; decision: Decision } | { ok: false; error: string };

/** Converts an arbitrary provider payload into the internal Decision schema, or rejects it. */
export function validateDecision(raw: unknown, actionMap: Record<string, string> = {}): ValidationResult {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ok: false, error: 'decision must be an object' };
  const r = raw as Record<string, unknown>;
  const action = normalizeAction(r.action, actionMap);
  if (!action) return { ok: false, error: `unknown action ${JSON.stringify(r.action)}` };
  let confidence = typeof r.confidence === 'number' ? r.confidence : typeof r.confidence === 'string' ? Number(r.confidence) : 0.5;
  if (!Number.isFinite(confidence)) return { ok: false, error: 'confidence is not a number' };
  if (confidence > 1 && confidence <= 100) confidence /= 100;
  if (confidence < 0 || confidence > 1) return { ok: false, error: `confidence out of range: ${confidence}` };
  const reason = typeof r.reason === 'string' ? r.reason.slice(0, 500) : '';
  return {
    ok: true,
    decision: {
      action,
      confidence,
      reason,
      timestamp: typeof r.timestamp === 'number' && Number.isFinite(r.timestamp) ? r.timestamp : Date.now(),
    },
  };
}

/** Extracts the first JSON object from free text (LLM outputs often wrap JSON in prose or fences). */
export function extractJsonObject(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    // fall through
  }
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  if (fence) {
    try {
      return JSON.parse(fence[1]);
    } catch {
      // fall through
    }
  }
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(trimmed.slice(start, end + 1));
    } catch {
      return undefined;
    }
  }
  return undefined;
}
