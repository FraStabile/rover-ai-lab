import type { Odometry, OdomConfig } from '@rover/protocol';
import { type Rng, wrapAngle, yawToQuaternion } from '@rover/shared';

/**
 * Wheel odometry: dead reckoning from (noisy) wheel encoder travel.
 * Accumulates drift exactly like a real encoder-based estimate.
 */
export class OdometrySensor {
  x = 0;
  y = 0;
  heading = 0;
  linear = 0;
  angular = 0;

  reset(x: number, y: number, heading: number): void {
    this.x = x;
    this.y = y;
    this.heading = heading;
    this.linear = 0;
    this.angular = 0;
  }

  /** Integrates one physics step. vLeft/vRight are true wheel rim speeds (m/s). */
  integrate(vLeft: number, vRight: number, wheelBase: number, dt: number, cfg: OdomConfig, rng: Rng, noiseMultiplier: number): void {
    const k = cfg.noise * noiseMultiplier;
    const dl = vLeft * dt * (1 + rng.noise(k));
    const dr = vRight * dt * (1 + rng.noise(k));
    const ds = (dl + dr) / 2;
    const dth = (dr - dl) / wheelBase;
    const mid = this.heading + dth / 2;
    this.x += ds * Math.cos(mid);
    this.y += ds * Math.sin(mid);
    this.heading = wrapAngle(this.heading + dth);
    this.linear = dt > 0 ? ds / dt : 0;
    this.angular = dt > 0 ? dth / dt : 0;
  }

  message(stamp: number, seq: number): Odometry {
    return {
      header: { stamp, frame_id: 'odom', seq },
      child_frame_id: 'base_link',
      pose: { pose: { position: { x: this.x, y: this.y, z: 0 }, orientation: yawToQuaternion(this.heading) } },
      twist: { twist: { linear: { x: this.linear, y: 0, z: 0 }, angular: { x: 0, y: 0, z: this.angular } } },
    };
  }
}
