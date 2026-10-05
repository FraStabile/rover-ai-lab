import type { Obstacle, Scenario } from '@rover/protocol';
import { circleOverlapsObstacle, pointObstacleDistance } from '@rover/shared';

export interface CollisionResult {
  collides: boolean;
  /** Obstacle id or 'wall'. */
  with: string | null;
}

/** Static 2D environment: walls at the world bounds plus rectangular/circular obstacles. */
export class World {
  width: number;
  height: number;
  obstacles: Obstacle[];

  constructor(scenario: Pick<Scenario, 'world' | 'obstacles'>) {
    this.width = scenario.world.width;
    this.height = scenario.world.height;
    this.obstacles = scenario.obstacles.map((o) => ({ ...o }));
  }
}

/** Circle-vs-world collision detection. */
export class CollisionDetector {
  constructor(private readonly world: World) {}

  checkCircle(x: number, y: number, r: number): CollisionResult {
    if (x - r < 0 || y - r < 0 || x + r > this.world.width || y + r > this.world.height) {
      return { collides: true, with: 'wall' };
    }
    for (const o of this.world.obstacles) {
      if (circleOverlapsObstacle(x, y, r, o)) return { collides: true, with: o.id };
    }
    return { collides: false, with: null };
  }

  /** Clearance from a point to the nearest obstacle or wall. */
  clearance(x: number, y: number): number {
    let best = Math.min(x, y, this.world.width - x, this.world.height - y);
    for (const o of this.world.obstacles) best = Math.min(best, pointObstacleDistance(x, y, o));
    return best;
  }
}
