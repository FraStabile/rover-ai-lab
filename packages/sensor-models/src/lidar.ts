import type { LaserScan, LidarConfig, Obstacle } from '@rover/protocol';
import { type Rng, deg2rad, rayBoundsInterior, rayObstacle } from '@rover/shared';

export interface WorldGeometry {
  width: number;
  height: number;
  obstacles: readonly Obstacle[];
}

export interface Pose2D {
  x: number;
  y: number;
  heading: number;
}

/** Exact (noise-free) range along a world-frame ray. */
export function castRay(world: WorldGeometry, ox: number, oy: number, angle: number, maxRange: number): number {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  let best = rayBoundsInterior(ox, oy, dx, dy, world.width, world.height);
  for (const o of world.obstacles) {
    const t = rayObstacle(ox, oy, dx, dy, o);
    if (t < best) best = t;
  }
  return Math.min(best, maxRange);
}

/** 2D LiDAR: ray casting against obstacles and world walls, gaussian range noise, random dropouts. */
export function simulateLaserScan(
  world: WorldGeometry,
  pose: Pose2D,
  cfg: LidarConfig,
  rng: Rng,
  noiseMultiplier: number,
  stamp: number,
  seq: number,
): LaserScan {
  const n = Math.max(2, Math.round(cfg.numberOfRays));
  const fov = deg2rad(Math.max(1, Math.min(360, cfg.fieldOfView)));
  const angleMin = -fov / 2;
  const angleMax = fov / 2;
  const inc = (angleMax - angleMin) / (n - 1);
  const ranges = new Array<number>(n);
  const std = cfg.noise * noiseMultiplier;
  for (let i = 0; i < n; i++) {
    const a = angleMin + i * inc;
    let r = castRay(world, pose.x, pose.y, pose.heading + a, cfg.range);
    if (cfg.dropout > 0 && rng.chance(cfg.dropout)) {
      r = cfg.range;
    } else if (r < cfg.range) {
      r = Math.max(cfg.rangeMin, Math.min(cfg.range, r + rng.noise(std)));
    }
    ranges[i] = r;
  }
  return {
    header: { stamp, frame_id: 'laser', seq },
    angle_min: angleMin,
    angle_max: angleMax,
    angle_increment: inc,
    time_increment: 0,
    scan_time: cfg.updateFrequency > 0 ? 1 / cfg.updateFrequency : 0,
    range_min: cfg.rangeMin,
    range_max: cfg.range,
    ranges,
    intensities: [],
  };
}
