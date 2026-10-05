import { describe, expect, it } from 'vitest';
import { createDefaultConfig } from '@rover/protocol';
import { BatteryModel, MotorModel, bodyExtent, cmdVelToWheelTargets, diffDriveForward, diffDriveInverse } from '../src';

describe('kinematics', () => {
  it('inverse and forward kinematics are consistent', () => {
    const { left, right } = diffDriveInverse(1, 0.5, 0.5);
    const tw = diffDriveForward(left, right, 0.5);
    expect(tw.linear).toBeCloseTo(1);
    expect(tw.angular).toBeCloseTo(0.5);
  });
  it('clamps commands to robot limits', () => {
    const cfg = createDefaultConfig().robot;
    const t = cmdVelToWheelTargets(10, 10, cfg);
    expect(Math.max(Math.abs(t.left), Math.abs(t.right))).toBeLessThanOrEqual(cfg.maxSpeed + 1e-9);
    expect(t.angular).toBeLessThanOrEqual(cfg.maxAngularVelocity);
  });
  it('computes body extent of the rectangular footprint', () => {
    expect(bodyExtent(0, 0.7, 0.5)).toBeCloseTo(0.35);
    expect(bodyExtent(Math.PI / 2, 0.7, 0.5)).toBeCloseTo(0.25);
  });
});

describe('MotorModel', () => {
  const cfg = createDefaultConfig().robot;
  it('accelerates within the acceleration limit', () => {
    const m = new MotorModel();
    m.update(1, 0.1, cfg, 'none', 24);
    expect(m.speed).toBeGreaterThan(0);
    expect(m.speed).toBeLessThanOrEqual(cfg.maxAcceleration * 0.1 + 1e-9);
  });
  it('a failed motor does not produce torque', () => {
    const m = new MotorModel();
    for (let i = 0; i < 100; i++) m.update(1, 0.02, cfg, 'failure', 24);
    expect(m.speed).toBe(0);
    expect(m.error).toBe('MOTOR_FAILURE');
  });
  it('overheat fault raises temperature until OVERHEAT', () => {
    const m = new MotorModel();
    for (let i = 0; i < 60 * 50; i++) m.update(0.5, 0.02, cfg, 'overheat', 24);
    expect(m.temperature).toBeGreaterThan(95);
    expect(m.error).toBe('OVERHEAT');
  });
});

describe('BatteryModel', () => {
  it('drains faster when moving and reports thresholds', () => {
    const c = createDefaultConfig();
    const idle = new BatteryModel(c.battery);
    const moving = new BatteryModel(c.battery);
    for (let i = 0; i < 1000; i++) {
      idle.update(0.1, 0, 0, c.robot, 1, 0);
      moving.update(0.1, 2, 0, c.robot, 1, 0);
    }
    expect(moving.soc).toBeLessThan(idle.soc);
    expect(moving.voltage).toBeLessThan(idle.voltage + 1e-9);
    const low = new BatteryModel({ ...c.battery, initialCharge: 0.1 });
    expect(low.health).toBe('LOW');
    const crit = new BatteryModel({ ...c.battery, initialCharge: 0.03 });
    expect(crit.health).toBe('CRITICAL');
    for (let i = 0; i < 10000; i++) crit.update(1, 2, 1.5, c.robot, 50, 0);
    expect(crit.dead).toBe(true);
    expect(crit.voltage).toBe(0);
  });
});
