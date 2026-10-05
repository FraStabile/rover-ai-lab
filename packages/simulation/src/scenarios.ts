import type { MissionDefinition, Obstacle, RandomScenarioParams, Scenario } from '@rover/protocol';
import { Rng, circleOverlapsObstacle } from '@rover/shared';

const W = 40;
const H = 30;

const reach = (maxDuration = 180): MissionDefinition => ({ objective: 'REACH_TARGET', tolerance: 0.6, maxDuration, failOnCollision: false });

const rect = (id: string, x: number, y: number, w: number, h: number): Obstacle => ({ id, kind: 'rect', x, y, w, h });
const circle = (id: string, x: number, y: number, r: number): Obstacle => ({ id, kind: 'circle', x, y, r });

function base(id: string, name: string, description: string, partial: Partial<Scenario>): Scenario {
  return {
    id,
    name,
    description,
    world: { width: W, height: H },
    rover: { x: 4, y: 15, heading: 0 },
    obstacles: [],
    target: { x: 36, y: 15 },
    waypoints: [],
    mission: reach(),
    builtIn: true,
    ...partial,
  };
}

export const PRESET_SCENARIOS: Scenario[] = [
  base('EMPTY_FIELD', 'Empty field', 'No obstacles. Verify kinematics, sensors and target tracking.', {
    rover: { x: 4, y: 4, heading: 0 },
    target: { x: 34, y: 24 },
  }),
  base('SINGLE_OBSTACLE', 'Single obstacle', 'One large round obstacle between start and target.', {
    obstacles: [circle('c1', 20, 15, 2.5)],
  }),
  base('MAZE', 'Maze', 'Serpentine walls. Reactive policies tend to get trapped: a planner benchmark.', {
    rover: { x: 5, y: 4, heading: 90 },
    target: { x: 35, y: 4 },
    obstacles: [
      rect('w1', 10, 11, 0.6, 22),
      rect('w2', 20, 19, 0.6, 22),
      rect('w3', 30, 11, 0.6, 22),
      rect('b1', 15, 24, 3, 0.6),
      rect('b2', 25, 6, 3, 0.6),
      circle('c1', 5, 18, 1),
      circle('c2', 35, 18, 1),
    ],
    mission: reach(400),
  }),
  base('NARROW_CORRIDOR', 'Narrow corridor', '1.6 m wide corridor: tests side clearance and speed limits.', {
    rover: { x: 3, y: 15, heading: 0 },
    target: { x: 37, y: 15 },
    obstacles: [
      rect('top', 20, 16.1, 24, 0.6),
      rect('bottom', 20, 13.9, 24, 0.6),
      rect('funnelTop', 7, 19.5, 0.6, 6.2),
      rect('funnelBottom', 7, 10.5, 0.6, 6.2),
    ],
  }),
  base('MULTIPLE_OBSTACLES', 'Multiple obstacles', 'Scattered rocks and boxes.', {
    rover: { x: 3, y: 3, heading: 30 },
    target: { x: 36, y: 26 },
    obstacles: [
      circle('c1', 10, 8, 1.5),
      circle('c2', 16, 14, 1.2),
      rect('r1', 22, 10, 3, 2),
      circle('c3', 25, 20, 1.8),
      rect('r2', 14, 22, 2, 4),
      circle('c4', 30, 15, 1.0),
      rect('r3', 32, 24, 1.5, 3),
      circle('c5', 6, 16, 1.0),
      rect('r4', 28, 5, 2.5, 2.5),
    ],
    mission: reach(240),
  }),
  base('TARGET_NAVIGATION', 'Waypoint navigation', 'Visit four waypoints then reach the target.', {
    rover: { x: 5, y: 5, heading: 0 },
    waypoints: [
      { x: 30, y: 6 },
      { x: 34, y: 24 },
      { x: 8, y: 25 },
    ],
    target: { x: 20, y: 15 },
    obstacles: [circle('c1', 20, 15 - 4, 1.2)],
    mission: { objective: 'FOLLOW_WAYPOINTS', tolerance: 0.8, maxDuration: 300, failOnCollision: false },
  }),
  base('OBSTACLE_AVOIDANCE', 'Obstacle avoidance', 'Dense field of obstacles across the direct route.', {
    rover: { x: 3, y: 15, heading: 0 },
    target: { x: 37, y: 15 },
    obstacles: [
      circle('a', 10, 15, 1.2),
      circle('b', 13, 11, 1.0),
      circle('c', 13, 19, 1.0),
      rect('d', 17, 15, 1.5, 4),
      circle('e', 21, 10, 1.3),
      circle('f', 21, 20, 1.3),
      rect('g', 25, 15, 2, 2),
      circle('h', 28, 11.5, 1.0),
      circle('i', 28, 18.5, 1.0),
      rect('j', 32, 15, 1, 5),
    ],
    mission: reach(240),
  }),
  base('LOW_BATTERY', 'Low battery', 'Starts at 16% with 12× drain: expect LOW_BATTERY, RETURN_HOME, then BATTERY_CRITICAL.', {
    initialBattery: 0.16,
    failures: { batteryDrain: 12 },
    rover: { x: 4, y: 15, heading: 0 },
    target: { x: 36, y: 15 },
    obstacles: [circle('c1', 20, 18, 1.5)],
  }),
  base('MOTOR_FAILURE', 'Motor failure', 'Left motor overheats progressively: safety derates and stops the rover.', {
    failures: { leftMotor: 'overheat' },
  }),
  base('GPS_LOSS', 'GPS loss', 'GPS reports NO_FIX for the whole run; navigation relies on odometry.', {
    failures: { gps: true },
    obstacles: [circle('c1', 18, 13, 1.5), rect('r1', 26, 17, 2, 3)],
  }),
];

export function getPreset(id: string): Scenario | undefined {
  const s = PRESET_SCENARIOS.find((p) => p.id === id);
  return s ? structuredClone(s) : undefined;
}

const DIFFICULTY = {
  easy: { minR: 0.5, maxR: 1.2, rectChance: 0.3 },
  medium: { minR: 0.7, maxR: 1.8, rectChance: 0.45 },
  hard: { minR: 0.8, maxR: 2.6, rectChance: 0.6 },
} as const;

/** Deterministic random scenario generator: same params (incl. seed) → identical scenario. */
export function generateRandomScenario(params: RandomScenarioParams): Scenario {
  const rng = new Rng(params.seed);
  const width = params.width ?? W;
  const height = params.height ?? H;
  const d = DIFFICULTY[params.difficulty] ?? DIFFICULTY.medium;
  const margin = 2;

  const rover = { x: rng.range(margin, width * 0.25), y: rng.range(margin, height - margin), heading: Math.round(rng.range(-180, 180)) };
  const maxDist = Math.max(5, params.maximumDistance);
  let target = { x: width - margin, y: height / 2 };
  for (let i = 0; i < 200; i++) {
    const dist = rng.range(maxDist * 0.6, maxDist);
    const ang = rng.range(-Math.PI / 2.2, Math.PI / 2.2);
    const tx = rover.x + Math.cos(ang) * dist;
    const ty = rover.y + Math.sin(ang) * dist;
    if (tx > margin && tx < width - margin && ty > margin && ty < height - margin) {
      target = { x: tx, y: ty };
      break;
    }
  }

  const obstacles: Obstacle[] = [];
  const keepClear = Math.max(1.5, params.minimumDistance);
  for (let i = 0, attempts = 0; i < params.numberOfObstacles && attempts < params.numberOfObstacles * 60; attempts++) {
    const isRect = rng.chance(d.rectChance);
    const x = rng.range(1, width - 1);
    const y = rng.range(1, height - 1);
    const o: Obstacle = isRect
      ? rect(`r${i}`, x, y, rng.range(d.minR, d.maxR) * 2, rng.range(d.minR, d.maxR) * 2)
      : circle(`c${i}`, x, y, rng.range(d.minR, d.maxR));
    if (circleOverlapsObstacle(rover.x, rover.y, keepClear, o)) continue;
    if (circleOverlapsObstacle(target.x, target.y, keepClear, o)) continue;
    const gap = params.minimumDistance / 2;
    const inflated: Obstacle = o.kind === 'circle' ? { ...o, r: o.r + gap } : { ...o, w: o.w + gap * 2, h: o.h + gap * 2 };
    const overlaps = obstacles.some((p) => {
      const pr = p.kind === 'circle' ? p.r : Math.hypot(p.w, p.h) / 2;
      return circleOverlapsObstacle(p.x, p.y, pr + gap, inflated);
    });
    if (overlaps) continue;
    obstacles.push(o);
    i++;
  }

  const round2 = (v: number) => Math.round(v * 100) / 100;
  return {
    id: `RANDOM_${params.seed}`,
    name: `Random #${params.seed} (${params.difficulty})`,
    description: `Generated: ${obstacles.length} obstacles, seed ${params.seed}`,
    world: { width, height },
    rover: { x: round2(rover.x), y: round2(rover.y), heading: rover.heading },
    obstacles: obstacles.map((o) =>
      o.kind === 'circle' ? { ...o, x: round2(o.x), y: round2(o.y), r: round2(o.r) } : { ...o, x: round2(o.x), y: round2(o.y), w: round2(o.w), h: round2(o.h) },
    ),
    target: { x: round2(target.x), y: round2(target.y) },
    waypoints: [],
    mission: reach(240),
  };
}

export function validateScenario(input: unknown): { ok: true; scenario: Scenario } | { ok: false; error: string } {
  if (typeof input !== 'object' || input === null) return { ok: false, error: 'scenario must be an object' };
  const s = input as Scenario;
  const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
  if (typeof s.name !== 'string' || !s.name.trim()) return { ok: false, error: 'name is required' };
  if (!s.world || !num(s.world.width) || !num(s.world.height) || s.world.width < 5 || s.world.height < 5 || s.world.width > 500 || s.world.height > 500) {
    return { ok: false, error: 'world.width/height must be between 5 and 500' };
  }
  if (!s.rover || !num(s.rover.x) || !num(s.rover.y) || !num(s.rover.heading)) return { ok: false, error: 'rover pose invalid' };
  if (!Array.isArray(s.obstacles)) return { ok: false, error: 'obstacles must be an array' };
  for (const o of s.obstacles) {
    if (o.kind === 'circle' ? !(num(o.x) && num(o.y) && num(o.r) && o.r > 0) : !(o.kind === 'rect' && num(o.x) && num(o.y) && num(o.w) && num(o.h) && o.w > 0 && o.h > 0)) {
      return { ok: false, error: `invalid obstacle ${JSON.stringify(o)}` };
    }
  }
  if (s.target !== null && s.target !== undefined && !(num(s.target.x) && num(s.target.y))) return { ok: false, error: 'target invalid' };
  const waypoints = Array.isArray(s.waypoints) ? s.waypoints.filter((w) => num(w?.x) && num(w?.y)) : [];
  const mission: MissionDefinition = { ...reach(), ...(s.mission ?? {}) };
  return {
    ok: true,
    scenario: {
      ...s,
      id: typeof s.id === 'string' && s.id ? s.id : `custom-${Date.now()}`,
      description: typeof s.description === 'string' ? s.description : '',
      target: s.target ?? null,
      waypoints,
      mission,
      obstacles: s.obstacles.map((o, i) => ({ ...o, id: o.id || `o${i}` })),
    },
  };
}
