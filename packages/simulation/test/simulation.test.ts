import { describe, expect, it } from 'vitest';
import { TOPICS, createDefaultConfig, type Scenario } from '@rover/protocol';
import { EventLogger } from '@rover/logging';
import { SimulationTransport } from '@rover/transport';
import { CollisionDetector, SimulationEngine, World, generateRandomScenario, getPreset, PRESET_SCENARIOS, validateScenario } from '../src';

function emptyScenario(patch: Partial<Scenario> = {}): Scenario {
  return { ...getPreset('EMPTY_FIELD')!, rover: { x: 5, y: 15, heading: 0 }, ...patch };
}

function makeEngine(s: Scenario) {
  const cfg = createDefaultConfig();
  let engine: SimulationEngine | null = null;
  const clock = { now: () => engine?.simTime ?? 0 };
  const transport = new SimulationTransport(clock);
  const logger = new EventLogger(clock.now);
  engine = new SimulationEngine({ transport, logger, config: cfg, scenario: s });
  const drive = (linear: number, angular: number) =>
    transport.publish(TOPICS.cmdVel, { linear: { x: linear, y: 0, z: 0 }, angular: { x: 0, y: 0, z: angular } });
  return { engine, transport, logger, cfg, drive };
}

describe('PhysicsEngine', () => {
  it('drives straight respecting max acceleration and max speed', () => {
    const { engine, drive, cfg } = makeEngine(emptyScenario());
    for (let i = 0; i < 50; i++) {
      drive(5, 0);
      engine.step(0.02);
    }
    // After 1 s at ≤1 m/s² the rover cannot exceed 1 m/s.
    expect(engine.rover.linear).toBeLessThanOrEqual(cfg.robot.maxAcceleration * 1 + 1e-6);
    for (let i = 0; i < 500; i++) {
      drive(5, 0);
      engine.step(0.02);
    }
    expect(engine.rover.linear).toBeLessThanOrEqual(cfg.robot.maxSpeed + 1e-6);
    expect(engine.rover.linear).toBeGreaterThan(cfg.robot.maxSpeed * 0.9);
    expect(engine.rover.y).toBeCloseTo(15, 3);
    expect(engine.rover.x).toBeGreaterThan(10);
  });

  it('turns in place', () => {
    const { engine, drive } = makeEngine(emptyScenario());
    for (let i = 0; i < 200; i++) {
      drive(0, 1);
      engine.step(0.02);
    }
    expect(engine.rover.angular).toBeCloseTo(1, 1);
    expect(Math.hypot(engine.rover.x - 5, engine.rover.y - 15)).toBeLessThan(0.01);
  });

  it('stops when /cmd_vel goes silent (watchdog)', () => {
    const { engine, drive } = makeEngine(emptyScenario());
    for (let i = 0; i < 100; i++) {
      drive(1, 0);
      engine.step(0.02);
    }
    for (let i = 0; i < 200; i++) engine.step(0.02);
    expect(engine.rover.linear).toBe(0);
  });
});

describe('CollisionDetector', () => {
  it('detects walls and obstacles', () => {
    const w = new World({ world: { width: 10, height: 10 }, obstacles: [{ id: 'b', kind: 'rect', x: 5, y: 5, w: 2, h: 2 }] });
    const c = new CollisionDetector(w);
    expect(c.checkCircle(0.2, 5, 0.3)).toEqual({ collides: true, with: 'wall' });
    expect(c.checkCircle(5, 6.2, 0.3)).toEqual({ collides: true, with: 'b' });
    expect(c.checkCircle(2, 2, 0.3).collides).toBe(false);
  });

  it('the rover never penetrates an obstacle and a COLLISION is logged', () => {
    const s = emptyScenario({ obstacles: [{ id: 'wall', kind: 'rect', x: 8, y: 15, w: 1, h: 10 }] });
    const { engine, drive, logger } = makeEngine(s);
    const events: string[] = [];
    logger.subscribe((e) => events.push(e.type));
    for (let i = 0; i < 500; i++) {
      drive(1, 0);
      engine.step(0.02);
    }
    expect(engine.rover.x).toBeLessThan(7.5 - 0.3);
    expect(engine.rover.collisions).toBe(1);
    expect(events).toContain('COLLISION');
  });
});

describe('Sensors in the engine', () => {
  it('publish at their configured rates', () => {
    const { engine, transport } = makeEngine(emptyScenario());
    for (let i = 0; i < 100; i++) engine.step(0.02);
    const counts = Object.fromEntries(transport.getTopicInfo().map((t) => [t.name, t.messageCount]));
    expect(counts['/scan']).toBeGreaterThanOrEqual(39);
    expect(counts['/scan']).toBeLessThanOrEqual(41);
    expect(counts['/imu']).toBe(100);
    // 2 s at 5 Hz / 1 Hz, first message at t=dt (inclusive of both ends).
    expect(counts['/gps']).toBeGreaterThanOrEqual(10);
    expect(counts['/gps']).toBeLessThanOrEqual(11);
    expect(counts['/battery']).toBeGreaterThanOrEqual(2);
    expect(counts['/battery']).toBeLessThanOrEqual(3);
  });

  it('LiDAR failure stops /scan publication', () => {
    const { engine, transport, cfg } = makeEngine(emptyScenario());
    cfg.failures.lidar = true;
    for (let i = 0; i < 50; i++) engine.step(0.02);
    expect(transport.getLastMessage('/scan')).toBeUndefined();
  });
});

describe('Mission', () => {
  it('completes when the rover reaches the target', () => {
    const { engine, drive } = makeEngine(emptyScenario({ target: { x: 8, y: 15 } }));
    engine.mission.start();
    for (let i = 0; i < 400 && engine.mission.state === 'RUNNING'; i++) {
      drive(1, 0);
      engine.step(0.02);
    }
    expect(engine.mission.state).toBe('COMPLETED');
  });
});

describe('Scenarios', () => {
  it('random generator is deterministic for a seed', () => {
    const p = { numberOfObstacles: 20, minimumDistance: 1.5, maximumDistance: 30, difficulty: 'medium' as const, seed: 42 };
    expect(generateRandomScenario(p)).toEqual(generateRandomScenario(p));
    expect(generateRandomScenario({ ...p, seed: 43 })).not.toEqual(generateRandomScenario(p));
  });
  it('random obstacles keep clear of the rover and target', () => {
    const s = generateRandomScenario({ numberOfObstacles: 40, minimumDistance: 1.5, maximumDistance: 30, difficulty: 'hard', seed: 7 });
    const c = new CollisionDetector(new World(s));
    expect(c.checkCircle(s.rover.x, s.rover.y, 1).collides).toBe(false);
    expect(c.checkCircle(s.target!.x, s.target!.y, 1).collides).toBe(false);
  });
  it('validates scenarios', () => {
    for (const p of PRESET_SCENARIOS) expect(validateScenario(p).ok).toBe(true);
    expect(validateScenario({ name: 'x' }).ok).toBe(false);
    expect(validateScenario({ ...PRESET_SCENARIOS[0], obstacles: [{ kind: 'circle', x: 1, y: 1, r: -1 }] }).ok).toBe(false);
  });
});
