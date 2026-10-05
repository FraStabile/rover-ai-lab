import type { AggregatedState } from '@rover/protocol';

type Patch = { [K in keyof AggregatedState]?: AggregatedState[K] extends object | null ? Partial<NonNullable<AggregatedState[K]>> | null : AggregatedState[K] };

/** A healthy, mission-running state with clear surroundings; override what the test needs. */
export function makeState(patch: Patch = {}): AggregatedState {
  const base: AggregatedState = {
    timestamp: 0,
    simTime: 1,
    robot: { x: 0, y: 0, heading: 0, speed: 0, angularVelocity: 0, localization: 'odom+gps' },
    obstacles: { front: 9, frontLeft: 9, frontRight: 9, left: 9, right: 9, nearest: 9, valid: true },
    target: { x: 20, y: 0, distance: 20, bearing: 0 },
    home: { distance: 0, bearing: 0 },
    battery: { percentage: 80, voltage: 24, state: 'GOOD' },
    motors: { left: 'OK', right: 'OK', maxTemperature: 30 },
    gps: { fix: true, latitude: 45, longitude: 9 },
    mission: { state: 'RUNNING', goalIndex: 0, goalCount: 1, tolerance: 0.6 },
    sensors: { lidar: 'OK', imu: 'OK', odom: 'OK', gps: 'OK' },
  };
  const out = structuredClone(base) as unknown as Record<string, unknown>;
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) out[k] = null;
    else if (typeof v === 'object') out[k] = { ...(out[k] as object), ...v };
    else out[k] = v;
  }
  return out as unknown as AggregatedState;
}
