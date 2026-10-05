import { AI_ACTIONS, type AggregatedState } from '@rover/protocol';

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
