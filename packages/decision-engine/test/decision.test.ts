import { describe, expect, it } from 'vitest';
import { createDefaultFailures } from '@rover/protocol';
import { FaultInjectingDecisionEngine, MockDecisionEngine, extractJsonObject, normalizeAction, validateDecision } from '../src';
import { makeState } from '../../autonomy/test/fixtures';

describe('validateDecision', () => {
  it('accepts valid decisions and normalises aliases', () => {
    const v = validateDecision({ action: 'turn left', confidence: 91, reason: 'x' });
    expect(v.ok && v.decision).toMatchObject({ action: 'TURN_LEFT', confidence: 0.91 });
    expect(normalizeAction('go')).toBe('FORWARD');
    expect(normalizeAction('l', { l: 'TURN_LEFT' })).toBe('TURN_LEFT');
  });
  it('rejects malformed decisions', () => {
    expect(validateDecision({ action: 'FLY' }).ok).toBe(false);
    expect(validateDecision({ action: 'STOP', confidence: 'very' }).ok).toBe(false);
    expect(validateDecision({ action: 'STOP', confidence: 2000 }).ok).toBe(false);
    expect(validateDecision('STOP').ok).toBe(false);
  });
  it('extracts JSON from LLM-style text', () => {
    expect(extractJsonObject('Sure! ```json\n{"action":"STOP"}\n```')).toEqual({ action: 'STOP' });
    expect(extractJsonObject('answer: {"action":"FORWARD","confidence":0.5} done')).toEqual({ action: 'FORWARD', confidence: 0.5 });
    expect(extractJsonObject('no json here')).toBeUndefined();
  });
});

describe('MockDecisionEngine', () => {
  const m = new MockDecisionEngine();
  it('turns away from a frontal obstacle toward the more open side', () => {
    m.reset();
    expect(m.decideSync(makeState({ obstacles: { front: 1.0, frontLeft: 4, frontRight: 1, left: 5, right: 1 } })).action).toBe('TURN_LEFT');
    m.reset();
    expect(m.decideSync(makeState({ obstacles: { front: 1.0, frontLeft: 1, frontRight: 4, left: 1, right: 5 } })).action).toBe('TURN_RIGHT');
  });
  it('turns toward a target with a large bearing', () => {
    m.reset();
    expect(m.decideSync(makeState({ target: { bearing: 90, distance: 10 } })).action).toBe('TURN_LEFT');
    expect(m.decideSync(makeState({ target: { bearing: -90, distance: 10 } })).action).toBe('TURN_RIGHT');
  });
  it('goes to target when clear, stops at goal or when the mission is idle', () => {
    m.reset();
    expect(m.decideSync(makeState()).action).toBe('REACH_TARGET');
    expect(m.decideSync(makeState({ target: { distance: 0.1, bearing: 0 } })).action).toBe('STOP');
    expect(m.decideSync(makeState({ mission: { state: 'IDLE' } })).action).toBe('STOP');
  });
  it('returns home on low battery', () => {
    m.reset();
    expect(m.decideSync(makeState({ battery: { percentage: 10, state: 'LOW' }, home: { distance: 20, bearing: 0 } })).action).toBe('RETURN_HOME');
  });
  it('produces the standard decision schema', async () => {
    const r = await m.decide(makeState(), { signal: new AbortController().signal });
    expect(r.decision).toMatchObject({ action: expect.any(String), confidence: expect.any(Number), reason: expect.any(String), timestamp: expect.any(Number) });
  });
});

describe('FaultInjectingDecisionEngine', () => {
  it('injects invalid responses', async () => {
    const f = createDefaultFailures();
    f.aiInvalidResponse = true;
    const e = new FaultInjectingDecisionEngine(new MockDecisionEngine(), () => f);
    const r = await e.decide(makeState(), { signal: new AbortController().signal });
    expect(r.decision).toBeNull();
    expect(r.error?.code).toBe('INVALID_DECISION');
  });
});
