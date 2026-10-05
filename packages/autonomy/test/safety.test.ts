import { describe, expect, it } from 'vitest';
import { createDefaultConfig } from '@rover/protocol';
import { SafetyController } from '../src';
import { makeState } from './fixtures';

const cfg = createDefaultConfig();
const safety = new SafetyController(
  () => cfg.safety,
  () => cfg.robot,
);
const auto = (over: Partial<Parameters<SafetyController['evaluate']>[0]> = {}) =>
  safety.evaluate({ mode: 'AUTO', requested: 'FORWARD', state: makeState(), estop: false, aiError: null, aiStale: false, ...over });

describe('SafetyController', () => {
  it('FUNDAMENTAL: obstacle closer than safety distance + AI FORWARD → EMERGENCY_STOP', () => {
    const v = auto({ requested: 'FORWARD', state: makeState({ obstacles: { front: 0.3 } }) });
    expect(v.verdict).toBe('OVERRIDE');
    expect(v.action).toBe('EMERGENCY_STOP');
    expect(v.rule).toBe('OBSTACLE_TOO_CLOSE');
    expect(safety.limit({ linear: 1, angular: 0 }, v)).toMatchObject({ linear: 0, angular: 0 });
  });

  it('also overrides REACH_TARGET when too close', () => {
    expect(auto({ requested: 'REACH_TARGET', state: makeState({ obstacles: { front: 0.2 } }) }).action).toBe('EMERGENCY_STOP');
  });

  it('allows turning away from a close obstacle but without forward motion', () => {
    const v = auto({ requested: 'TURN_LEFT', state: makeState({ obstacles: { front: 0.3 } }) });
    expect(v.verdict).toBe('ALLOW');
    expect(v.action).toBe('TURN_LEFT');
    const cmd = safety.limit({ linear: 0.3, angular: 0.8 }, v);
    expect(cmd.linear).toBe(0);
    expect(cmd.angular).toBeCloseTo(0.8);
  });

  it('allows FORWARD in free space', () => {
    const v = auto();
    expect(v).toMatchObject({ verdict: 'ALLOW', action: 'FORWARD', rule: 'NONE' });
  });

  it('stops for an imminent collision given the stopping distance', () => {
    const v = auto({ state: makeState({ obstacles: { front: 1.0 }, robot: { speed: 2 } }) });
    expect(v.action).toBe('EMERGENCY_STOP');
    expect(v.rule).toBe('COLLISION_IMMINENT');
  });

  it('limits speed in the slow-down zone', () => {
    const v = auto({ state: makeState({ obstacles: { front: 1.3 }, robot: { speed: 0.2 } }) });
    const cmd = safety.limit({ linear: 1.5, angular: 0 }, v);
    expect(cmd.linear).toBeCloseTo(cfg.safety.maxSpeed * cfg.safety.slowDownFactor);
  });

  it('enforces global max speed and angular velocity', () => {
    const v = auto();
    const cmd = safety.limit({ linear: 50, angular: -50 }, v);
    expect(cmd.linear).toBe(cfg.safety.maxSpeed);
    expect(cmd.angular).toBe(-cfg.safety.maxAngularVelocity);
  });

  it('blocks on emergency stop, battery critical, motor failure', () => {
    expect(auto({ estop: true })).toMatchObject({ verdict: 'BLOCK', action: 'EMERGENCY_STOP', rule: 'EMERGENCY_STOP_LATCHED' });
    expect(auto({ state: makeState({ battery: { state: 'CRITICAL', percentage: 3 } }) })).toMatchObject({ verdict: 'BLOCK', rule: 'BATTERY_CRITICAL' });
    expect(auto({ state: makeState({ motors: { left: 'MOTOR_FAILURE' } }) })).toMatchObject({ verdict: 'BLOCK', rule: 'MOTOR_FAILURE' });
  });

  it('handles invalid AI responses and AI timeouts deterministically', () => {
    expect(auto({ aiError: 'INVALID_DECISION' })).toMatchObject({ verdict: 'BLOCK', action: 'STOP', rule: 'INVALID_AI_RESPONSE' });
    expect(auto({ aiError: 'TIMEOUT' })).toMatchObject({ verdict: 'BLOCK', action: 'STOP', rule: 'AI_TIMEOUT' });
    expect(auto({ aiStale: true })).toMatchObject({ rule: 'AI_TIMEOUT' });
    expect(auto({ requested: null })).toMatchObject({ verdict: 'BLOCK', rule: 'NO_DECISION' });
  });

  it('degrades instead of stopping when the timeout policy says so', () => {
    const c2 = createDefaultConfig();
    c2.safety.onAiTimeout = 'SLOW_DOWN';
    const s2 = new SafetyController(
      () => c2.safety,
      () => c2.robot,
    );
    const v = s2.evaluate({ mode: 'AUTO', requested: 'FORWARD', state: makeState(), estop: false, aiError: 'TIMEOUT', aiStale: true });
    expect(v).toMatchObject({ verdict: 'OVERRIDE', action: 'SLOW_DOWN', rule: 'AI_TIMEOUT' });
  });

  it('blocks motion when LiDAR data is unavailable', () => {
    expect(auto({ state: makeState({ obstacles: { valid: false }, sensors: { lidar: 'STALE' } }) })).toMatchObject({ verdict: 'BLOCK', rule: 'SENSOR_FAILURE' });
  });

  it('does not move when the mission is not running', () => {
    expect(auto({ state: makeState({ mission: { state: 'COMPLETED' } }) })).toMatchObject({ action: 'STOP', rule: 'MISSION_INACTIVE' });
  });

  it('protects overheating motors by slowing down', () => {
    const v = auto({ state: makeState({ motors: { maxTemperature: 90 } }) });
    expect(v).toMatchObject({ verdict: 'OVERRIDE', action: 'SLOW_DOWN', rule: 'MOTOR_OVERHEAT' });
    expect(safety.limit({ linear: 1, angular: 0 }, v).linear).toBeCloseTo(0.3);
  });

  it('in MANUAL blocks forward motion into an obstacle but allows reversing', () => {
    const state = makeState({ obstacles: { front: 0.2 } });
    const fwd = safety.evaluate({ mode: 'MANUAL', requested: 'MANUAL', manual: { linear: 1, angular: 0 }, state, estop: false, aiError: null, aiStale: false });
    expect(safety.limit({ linear: 1, angular: 0.5 }, fwd)).toMatchObject({ linear: 0, angular: 0.5 });
    const rev = safety.evaluate({ mode: 'MANUAL', requested: 'MANUAL', manual: { linear: -0.5, angular: 0 }, state, estop: false, aiError: null, aiStale: false });
    expect(safety.limit({ linear: -0.5, angular: 0 }, rev).linear).toBe(-0.5);
  });
});
