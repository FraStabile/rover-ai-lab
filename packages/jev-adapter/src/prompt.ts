import { AI_ACTIONS, type AggregatedState, type AiAction, type JevProtocol } from '@rover/protocol';

export const SCHEMA_VERSION = 'rover-ai-lab/1';

export const SYSTEM_PROMPT = [
  'You are the high-level decision module of an autonomous ground rover.',
  'You receive a compact JSON world state and must answer with ONE JSON object:',
  '{"action": <one of ' + AI_ACTIONS.join(', ') + '>, "confidence": <0..1>, "reason": <short string>}.',
  'Conventions: distances in metres, angles in degrees, bearing > 0 means the target is to the LEFT.',
  'obstacles.* are clearances from the rover body. A deterministic safety layer will veto unsafe actions.',
  'Answer with JSON only.',
].join('\n');

export function nativeRequestBody(model: string, state: AggregatedState): Record<string, unknown> {
  return {
    schema_version: SCHEMA_VERSION,
    model,
    state,
    allowed_actions: AI_ACTIONS,
    response_format: { action: 'string', confidence: 'number 0..1', reason: 'string' },
  };
}

export function chatRequestBody(model: string, state: AggregatedState, temperature: number): Record<string, unknown> {
  return {
    model,
    temperature,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: JSON.stringify(state) },
    ],
  };
}

/** Option descriptions sent as `criteria` of the jevos `choice` question. */
export const ACTION_DESCRIPTIONS: Record<AiAction, string> = {
  FORWARD: 'drive straight ahead at cruise speed',
  TURN_LEFT: 'turn left (counter-clockwise), slowly or in place',
  TURN_RIGHT: 'turn right (clockwise), slowly or in place',
  REVERSE: 'back up slowly',
  STOP: 'stand still',
  SLOW_DOWN: 'keep going forward slowly',
  REACH_TARGET: 'drive toward the target, steering to reduce the bearing',
  RETURN_HOME: 'drive back to the start position',
};

/** jevos / Jev `POST /v1/systemone` body: the state plus one `choice` question over the allowed actions. */
export function systemoneRequestBody(model: string, state: AggregatedState, instructions: string): Record<string, unknown> {
  return {
    model,
    state,
    questions: {
      action: { type: 'choice', instructions, criteria: { ...ACTION_DESCRIPTIONS } },
    },
  };
}

const DEFAULT_PATHS: Record<JevProtocol, { decide: string; health: string }> = {
  systemone: { decide: '/v1/systemone', health: '/health' },
  native: { decide: '/decide', health: '/health' },
  'openai-chat': { decide: '/v1/chat/completions', health: '/v1/models' },
};

/** Configured path, or the protocol default when empty or left at another protocol's default. */
export function resolveJevPath(protocol: JevProtocol, configured: string, kind: 'decide' | 'health'): string {
  const own = DEFAULT_PATHS[protocol][kind];
  const others = Object.values(DEFAULT_PATHS).map((d) => d[kind]);
  if (!configured || (configured !== own && others.includes(configured))) return own;
  return configured;
}
