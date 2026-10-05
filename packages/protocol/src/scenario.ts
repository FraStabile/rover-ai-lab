import type { DeepPartial, FailureConfig } from './config';

export interface Point2 {
  x: number;
  y: number;
}

export interface RectObstacle {
  id: string;
  kind: 'rect';
  /** Centre (m). Rectangles are axis-aligned. */
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface CircleObstacle {
  id: string;
  kind: 'circle';
  x: number;
  y: number;
  r: number;
}

export type Obstacle = RectObstacle | CircleObstacle;

export interface MissionDefinition {
  objective: 'REACH_TARGET' | 'FOLLOW_WAYPOINTS' | 'FREE_ROAM';
  /** Distance (m) under which a goal counts as reached. */
  tolerance: number;
  /** Seconds of sim time before the mission FAILS (0 = unlimited). */
  maxDuration: number;
  failOnCollision: boolean;
}

export interface Scenario {
  id: string;
  name: string;
  description: string;
  /** World is the rectangle [0,width] × [0,height] metres, bounded by walls. */
  world: { width: number; height: number };
  rover: { x: number; y: number; /** degrees, CCW from +X */ heading: number };
  obstacles: Obstacle[];
  target: Point2 | null;
  waypoints: Point2[];
  mission: MissionDefinition;
  /** Optional initial battery fraction override. */
  initialBattery?: number;
  /** Optional failure preset applied on load. */
  failures?: Partial<FailureConfig>;
  /** Optional config overrides applied on load. */
  overrides?: DeepPartial<{ sensors: { gps: { enabled: boolean } } }>;
  builtIn?: boolean;
}

export interface RandomScenarioParams {
  numberOfObstacles: number;
  /** Minimum clearance between obstacles / rover / target (m). */
  minimumDistance: number;
  /** Minimum and maximum start→target distance (m). */
  maximumDistance: number;
  difficulty: 'easy' | 'medium' | 'hard';
  seed: number;
  width?: number;
  height?: number;
}
