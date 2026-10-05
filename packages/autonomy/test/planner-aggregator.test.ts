import { describe, expect, it } from 'vitest';
import { MSG_TYPES, TOPICS, createDefaultConfig, type LaserScan } from '@rover/protocol';
import { SimulationTransport } from '@rover/transport';
import { LocalPlanner, StateAggregator, computeSectors } from '../src';
import { makeState } from './fixtures';

const cfg = createDefaultConfig();
const planner = new LocalPlanner(
  () => cfg.planner,
  () => cfg.robot,
  () => cfg.safety,
);

describe('LocalPlanner', () => {
  it('maps actions to velocity commands', () => {
    const s = makeState();
    expect(planner.plan('STOP', s)).toEqual({ linear: 0, angular: 0 });
    expect(planner.plan('EMERGENCY_STOP', s)).toEqual({ linear: 0, angular: 0 });
    expect(planner.plan('FORWARD', s)).toEqual({ linear: cfg.planner.cruiseSpeed, angular: 0 });
    expect(planner.plan('REVERSE', s).linear).toBeLessThan(0);
    const left = planner.plan('TURN_LEFT', s);
    expect(left.angular).toBeCloseTo(cfg.robot.maxAngularVelocity * cfg.robot.turnRate);
    expect(left.linear).toBeCloseTo(cfg.planner.turnLinearSpeed);
    expect(planner.plan('TURN_RIGHT', s).angular).toBeLessThan(0);
  });
  it('turns in place when an obstacle is close', () => {
    expect(planner.plan('TURN_LEFT', makeState({ obstacles: { front: 0.4 } })).linear).toBe(0);
  });
  it('steers toward the target for REACH_TARGET', () => {
    const cmd = planner.plan('REACH_TARGET', makeState({ target: { bearing: 20, distance: 10 } }));
    expect(cmd.angular).toBeGreaterThan(0);
    expect(cmd.linear).toBeGreaterThan(0);
    expect(planner.plan('REACH_TARGET', makeState({ target: { bearing: 120, distance: 10 } })).linear).toBe(0);
  });
});

function scan(ranges: number[], fovDeg = 270): LaserScan {
  const fov = (fovDeg * Math.PI) / 180;
  return {
    header: { stamp: 0, frame_id: 'laser', seq: 0 },
    angle_min: -fov / 2,
    angle_max: fov / 2,
    angle_increment: fov / (ranges.length - 1),
    time_increment: 0,
    scan_time: 0.05,
    range_min: 0.1,
    range_max: 10,
    ranges,
    intensities: [],
  };
}

describe('StateAggregator', () => {
  it('reduces a scan to body clearances per sector', () => {
    const r = new Array(271).fill(10);
    r[135] = 1.35; // straight ahead (0°)
    r[135 + 90] = 2.25; // left (90°)
    const s = computeSectors(scan(r), 0.7, 0.5);
    expect(s.front).toBeCloseTo(1.0);
    expect(s.left).toBeCloseTo(2.0);
    // Sector minimum is at the diagonal edge (-135°) where the body extent is ~0.354 m.
    expect(s.right).toBeCloseTo(10 - 0.354, 2);
  });

  it('builds the compact state from topics', () => {
    let t = 0;
    const bus = new SimulationTransport({ now: () => t });
    bus.advertise(TOPICS.scan, MSG_TYPES.LaserScan, '/l', 20);
    const agg = new StateAggregator(bus, () => cfg);
    t = 1;
    bus.publish(TOPICS.odom, {
      header: { stamp: 1, frame_id: 'odom', seq: 0 },
      child_frame_id: 'base_link',
      pose: { pose: { position: { x: 2, y: 3, z: 0 }, orientation: { x: 0, y: 0, z: Math.sin(Math.PI / 4), w: Math.cos(Math.PI / 4) } } },
      twist: { twist: { linear: { x: 0.5, y: 0, z: 0 }, angular: { x: 0, y: 0, z: 0 } } },
    });
    bus.publish(TOPICS.scan, scan(new Array(181).fill(5)));
    bus.publish(TOPICS.mission, { header: { stamp: 1, frame_id: 'map', seq: 0 }, state: 'RUNNING', goal: { x: 2, y: 13 }, goalIndex: 0, goalCount: 1, home: { x: 0, y: 0 }, tolerance: 0.5, elapsed: 0, reason: '' });
    const s = agg.build(1);
    expect(s.robot).toMatchObject({ x: 2, y: 3, heading: 90, speed: 0.5 });
    expect(s.target?.distance).toBeCloseTo(10);
    expect(s.target?.bearing).toBeCloseTo(0);
    expect(s.obstacles.valid).toBe(true);
    expect(s.obstacles.front).toBeCloseTo(4.65, 1);
    expect(s.mission.state).toBe('RUNNING');
    // Stale LiDAR invalidates obstacle data.
    expect(agg.build(5).obstacles.valid).toBe(false);
    expect(agg.build(5).sensors.lidar).toBe('STALE');
  });
});
