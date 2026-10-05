import type { MissionState, MotorError } from './messages';

/** High-level actions the decision layer may request. It never commands motors directly. */
export const AI_ACTIONS = [
  'FORWARD',
  'TURN_LEFT',
  'TURN_RIGHT',
  'REVERSE',
  'STOP',
  'SLOW_DOWN',
  'REACH_TARGET',
  'RETURN_HOME',
] as const;
export type AiAction = (typeof AI_ACTIONS)[number];

/** Actions the safety layer can additionally emit. */
export type SafetyAction = AiAction | 'EMERGENCY_STOP';

/** Internal, provider-independent decision schema. */
export interface Decision {
  action: AiAction;
  /** 0..1 */
  confidence: number;
  reason: string;
  /** Wall-clock ms (Date.now()) when the decision was produced. */
  timestamp: number;
  /** Optional provider-specific extras (never interpreted downstream). */
  meta?: Record<string, unknown>;
}

export type DecisionErrorCode =
  | 'TIMEOUT'
  | 'NETWORK'
  | 'HTTP_ERROR'
  | 'INVALID_JSON'
  | 'INVALID_DECISION'
  | 'ENGINE_ERROR'
  | 'DISABLED';

export interface DecisionResult {
  decision: Decision | null;
  error?: { code: DecisionErrorCode; message: string };
  /** Wall-clock latency of the call in ms. */
  latencyMs: number;
  /** Raw payloads for the AI inspector. */
  raw?: { request?: unknown; response?: unknown };
}

export interface HealthStatus {
  ok: boolean;
  latencyMs: number;
  message: string;
}

export interface ModelInfo {
  provider: string;
  model: string;
  endpoint?: string;
  version?: string;
  description?: string;
}

export interface ObstacleSectors {
  /** Clearance (m) from the rover body to the nearest return in each sector. */
  front: number;
  frontLeft: number;
  frontRight: number;
  left: number;
  right: number;
}

/**
 * Compact world state handed to the decision model.
 * Angles in degrees, ROS convention (REP-103): CCW positive, so a positive
 * bearing means "target is to the LEFT".
 */
export interface AggregatedState {
  timestamp: number;
  simTime: number;
  robot: {
    x: number;
    y: number;
    heading: number;
    speed: number;
    angularVelocity: number;
    /** 'odom+gps' when GPS corrections are being fused, 'odom' when dead reckoning only. */
    localization: 'odom' | 'odom+gps';
  };
  obstacles: ObstacleSectors & { valid: boolean; nearest: number };
  target: { x: number; y: number; distance: number; bearing: number } | null;
  home: { distance: number; bearing: number };
  battery: { percentage: number; voltage: number; state: 'GOOD' | 'LOW' | 'CRITICAL' | 'DEAD' };
  motors: {
    left: MotorError | 'OK';
    right: MotorError | 'OK';
    maxTemperature: number;
  };
  gps: { fix: boolean; latitude: number | null; longitude: number | null };
  mission: { state: MissionState; goalIndex: number; goalCount: number; tolerance: number };
  sensors: {
    lidar: SensorHealth;
    imu: SensorHealth;
    odom: SensorHealth;
    gps: SensorHealth;
  };
}

export type SensorHealth = 'OK' | 'STALE' | 'MISSING';

export type SafetyVerdictKind = 'ALLOW' | 'OVERRIDE' | 'BLOCK';

export type SafetyRule =
  | 'NONE'
  | 'EMERGENCY_STOP_LATCHED'
  | 'INVALID_AI_RESPONSE'
  | 'AI_TIMEOUT'
  | 'NO_DECISION'
  | 'SENSOR_FAILURE'
  | 'MOTOR_FAILURE'
  | 'MOTOR_OVERHEAT'
  | 'BATTERY_CRITICAL'
  | 'OBSTACLE_TOO_CLOSE'
  | 'COLLISION_IMMINENT'
  | 'SPEED_LIMIT'
  | 'MISSION_INACTIVE';

export interface SafetyVerdict {
  verdict: SafetyVerdictKind;
  /** Action actually passed to the planner. */
  action: SafetyAction;
  /** Action originally requested (AI or manual). */
  requested: SafetyAction | 'MANUAL' | null;
  rule: SafetyRule;
  reason: string;
  /** Multiplicative speed scale imposed by safety (1 = no limit). */
  speedScale: number;
}

export type AiLinkStatus = 'DISABLED' | 'MOCK' | 'CONNECTED' | 'OFFLINE' | 'TIMEOUT' | 'ERROR' | 'UNKNOWN';

export interface AiExchange {
  id: number;
  simTime: number;
  timestamp: number;
  provider: string;
  model: string;
  state: AggregatedState;
  request: unknown;
  response: unknown;
  decision: Decision | null;
  error?: { code: DecisionErrorCode; message: string };
  latencyMs: number;
  /** Extra latency injected by failure injection (sim seconds). */
  injectedLatencyMs: number;
}
