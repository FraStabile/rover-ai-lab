import { describe, expect, it } from 'vitest';
import { createDefaultConfig } from '@rover/protocol';
import { Rng } from '@rover/shared';
import { OdometrySensor, castRay, geodeticToLocal, localToGeodetic, simulateGps, simulateLaserScan } from '../src';

const world = { width: 20, height: 20, obstacles: [{ id: 'c', kind: 'circle' as const, x: 10, y: 5, r: 1 }] };

describe('LiDAR', () => {
  it('detects an obstacle straight ahead', () => {
    expect(castRay(world, 5, 5, 0, 10)).toBeCloseTo(4);
  });
  it('detects world walls and clamps to range', () => {
    expect(castRay(world, 5, 5, Math.PI, 10)).toBeCloseTo(5);
    expect(castRay(world, 5, 5, Math.PI / 2, 10)).toBeCloseTo(10);
  });
  it('produces a ROS-like LaserScan with the configured geometry', () => {
    const cfg = { ...createDefaultConfig().sensors.lidar, noise: 0 };
    const scan = simulateLaserScan(world, { x: 5, y: 5, heading: 0 }, cfg, new Rng(1), 1, 0, 0);
    expect(scan.ranges).toHaveLength(180);
    expect(scan.angle_min).toBeCloseTo(-(270 / 2) * (Math.PI / 180));
    expect(scan.range_max).toBe(10);
    const mid = scan.ranges[Math.round((0 - scan.angle_min) / scan.angle_increment)];
    expect(mid).toBeCloseTo(4, 1);
  });
  it('noise is deterministic per seed', () => {
    const cfg = createDefaultConfig().sensors.lidar;
    const a = simulateLaserScan(world, { x: 5, y: 5, heading: 0 }, cfg, new Rng(3), 1, 0, 0);
    const b = simulateLaserScan(world, { x: 5, y: 5, heading: 0 }, cfg, new Rng(3), 1, 0, 0);
    expect(a.ranges).toEqual(b.ranges);
  });
});

describe('Odometry', () => {
  it('integrates straight motion and rotation', () => {
    const o = new OdometrySensor();
    o.reset(0, 0, 0);
    const cfg = { enabled: true, updateFrequency: 50, noise: 0 };
    for (let i = 0; i < 100; i++) o.integrate(1, 1, 0.5, 0.01, cfg, new Rng(1), 1);
    expect(o.x).toBeCloseTo(1);
    expect(o.y).toBeCloseTo(0);
    for (let i = 0; i < 100; i++) o.integrate(-0.25, 0.25, 0.5, 0.01, cfg, new Rng(1), 1);
    expect(o.heading).toBeCloseTo(1);
    const msg = o.message(1, 0);
    expect(msg.child_frame_id).toBe('base_link');
  });
});

describe('GPS', () => {
  it('round-trips local ↔ geodetic coordinates', () => {
    const cfg = createDefaultConfig().sensors.gps;
    const g = localToGeodetic(12.5, -3, cfg);
    const l = geodeticToLocal(g.latitude, g.longitude, cfg);
    expect(l.x).toBeCloseTo(12.5, 6);
    expect(l.y).toBeCloseTo(-3, 6);
  });
  it('adds configurable noise', () => {
    const cfg = { ...createDefaultConfig().sensors.gps, noise: 0 };
    const fix = simulateGps(10, 10, cfg, new Rng(1), 1, 0, 0);
    const l = geodeticToLocal(fix.latitude, fix.longitude, cfg);
    expect(l.x).toBeCloseTo(10, 6);
    expect(fix.status.status).toBe(0);
  });
});
