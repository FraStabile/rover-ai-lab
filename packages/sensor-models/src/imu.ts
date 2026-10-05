import type { Imu, ImuConfig } from '@rover/protocol';
import { type Rng, yawToQuaternion } from '@rover/shared';

export interface ImuTruth {
  heading: number;
  angularVelocity: number;
  /** Longitudinal acceleration (m/s²) in the body frame. */
  longitudinalAccel: number;
  linearVelocity: number;
}

/** 6-DOF IMU (planar motion): accelerometer incl. centripetal term, gyro with random-walk bias. */
export class ImuSensor {
  private bias = 0;

  reset(): void {
    this.bias = 0;
  }

  measure(truth: ImuTruth, cfg: ImuConfig, rng: Rng, noiseMultiplier: number, dt: number, stamp: number, seq: number): Imu {
    this.bias += rng.noise(cfg.gyroBias * Math.sqrt(Math.max(dt, 1e-6)));
    const centripetal = truth.linearVelocity * truth.angularVelocity;
    const yaw = truth.heading + rng.noise(cfg.orientationNoise * noiseMultiplier);
    return {
      header: { stamp, frame_id: 'imu_link', seq },
      orientation: yawToQuaternion(yaw),
      angular_velocity: {
        x: rng.noise(cfg.gyroNoise * noiseMultiplier),
        y: rng.noise(cfg.gyroNoise * noiseMultiplier),
        z: truth.angularVelocity + this.bias + rng.noise(cfg.gyroNoise * noiseMultiplier),
      },
      linear_acceleration: {
        x: truth.longitudinalAccel + rng.noise(cfg.accelNoise * noiseMultiplier),
        y: centripetal + rng.noise(cfg.accelNoise * noiseMultiplier),
        z: 9.81 + rng.noise(cfg.accelNoise * noiseMultiplier),
      },
    };
  }
}
