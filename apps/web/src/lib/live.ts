import type { SimFrame } from '@rover/protocol';

/**
 * High-rate data lives outside React state: the canvas reads it every animation frame,
 * charts sample it a few times per second. This keeps React re-renders cheap.
 */
export interface TelemetrySample {
  t: number;
  speed: number;
  accel: number;
  angular: number;
  battery: number;
  voltage: number;
  current: number;
  rpmL: number;
  rpmR: number;
  tempL: number;
  tempR: number;
  latency: number | null;
  cmdLinear: number;
  cmdAngular: number;
}

const MAX_SAMPLES = 600;
const MAX_TRAIL = 4000;

export const live = {
  frame: null as SimFrame | null,
  trail: [] as Array<{ x: number; y: number }>,
  odomTrail: [] as Array<{ x: number; y: number }>,
  samples: [] as TelemetrySample[],
  frameCount: 0,
  lastSimTime: -1,
  lastSampleTime: -1,
};

export function sampleFromFrame(f: SimFrame): TelemetrySample {
  return {
    t: f.simTime,
    speed: f.velocity.linear,
    accel: f.acceleration,
    angular: f.velocity.angular,
    battery: f.battery.percentage,
    voltage: f.battery.voltage,
    current: f.battery.current,
    rpmL: f.motors.left.rpm,
    rpmR: f.motors.right.rpm,
    tempL: f.motors.left.temperature,
    tempR: f.motors.right.temperature,
    latency: f.ai.latencyMs,
    cmdLinear: f.cmdVel.linear,
    cmdAngular: f.cmdVel.angular,
  };
}

export function pushLiveFrame(f: SimFrame): void {
  // Time went backwards → simulation was reset.
  if (f.simTime < live.lastSimTime - 1e-6) resetLive();
  live.frame = f;
  live.frameCount++;
  live.lastSimTime = f.simTime;
  const last = live.trail[live.trail.length - 1];
  if (!last || Math.hypot(last.x - f.pose.x, last.y - f.pose.y) > 0.05) {
    live.trail.push({ x: f.pose.x, y: f.pose.y });
    live.odomTrail.push({ x: f.odomPose.x, y: f.odomPose.y });
    if (live.trail.length > MAX_TRAIL) {
      live.trail.splice(0, live.trail.length - MAX_TRAIL);
      live.odomTrail.splice(0, live.odomTrail.length - MAX_TRAIL);
    }
  }
  if (f.simTime - live.lastSampleTime >= 0.1 || f.simTime < live.lastSampleTime) {
    live.lastSampleTime = f.simTime;
    live.samples.push(sampleFromFrame(f));
    if (live.samples.length > MAX_SAMPLES) live.samples.splice(0, live.samples.length - MAX_SAMPLES);
  }
}

export function resetLive(): void {
  live.trail = [];
  live.odomTrail = [];
  live.samples = [];
  live.lastSampleTime = -1;
  live.lastSimTime = -1;
}
