import type { MotorChannel, MotorError, MotorFault, RobotConfig } from '@rover/protocol';
import { approach } from '@rover/shared';

const AMBIENT_C = 25;
const TORQUE_CONSTANT = 0.25; // Nm/A
const HEAT_COEFF = 0.005; // °C/s per A²
const COOL_COEFF = 0.01; // 1/s
const HARDWARE_TEMP_LIMIT = 95;
const OVERCURRENT_A = 15;

/** Brushed DC motor + gearbox driving one wheel (lumped, first-order model). */
export class MotorModel {
  /** Wheel rim speed (m/s). */
  speed = 0;
  temperature = AMBIENT_C;
  current = 0;
  voltage = 0;
  error: MotorError = 'NONE';
  private lastAccel = 0;

  reset(): void {
    this.speed = 0;
    this.temperature = AMBIENT_C;
    this.current = 0;
    this.voltage = 0;
    this.error = 'NONE';
    this.lastAccel = 0;
  }

  /**
   * @param target wheel speed set-point (m/s)
   * @param supplyVoltage battery voltage, 0 when the battery is dead
   */
  update(target: number, dt: number, cfg: RobotConfig, fault: MotorFault, supplyVoltage: number): void {
    const powered = supplyVoltage > 0 && fault !== 'failure';
    const prev = this.speed;
    let effectiveTarget = powered ? target : 0;
    // Thermal protection derates the motor.
    if (this.temperature > HARDWARE_TEMP_LIMIT) effectiveTarget *= 0.3;

    if (powered) {
      // Braking (toward zero or reversing) is easier than accelerating.
      const braking = this.speed !== 0 && (Math.abs(effectiveTarget) < Math.abs(this.speed) || Math.sign(effectiveTarget) !== Math.sign(this.speed));
      const accel = cfg.maxAcceleration * Math.max(0.1, 1 - cfg.friction) * (braking ? 2 : 1);
      this.speed = approach(this.speed, effectiveTarget, accel * dt);
    } else {
      // Unpowered/failed: the wheel is dragged to a halt by friction and the gearbox.
      const decel = Math.max(cfg.friction * 9.81, 0.5) * (fault === 'failure' ? 4 : 1);
      this.speed = approach(this.speed, 0, decel * dt);
    }
    if (Math.abs(this.speed) < 1e-6) this.speed = 0;

    this.lastAccel = (this.speed - prev) / dt;
    const halfMass = cfg.mass / 2;
    const rolling = Math.abs(this.speed) > 1e-3 ? cfg.friction * 9.81 * halfMass : 0;
    const force = halfMass * Math.abs(this.lastAccel) + rolling;
    let current = powered ? 0.2 + (force * cfg.wheelRadius) / TORQUE_CONSTANT : 0;
    if (fault === 'high_current' && powered) current = current * 3 + 4;
    this.current = current;
    this.voltage = powered ? supplyVoltage : 0;

    let heating = HEAT_COEFF * current * current;
    let cooling = COOL_COEFF;
    if (fault === 'overheat') {
      heating += 3;
      cooling = 0.002;
    }
    this.temperature += (heating - (this.temperature - AMBIENT_C) * cooling) * dt;

    this.error =
      fault === 'failure'
        ? 'MOTOR_FAILURE'
        : this.temperature > HARDWARE_TEMP_LIMIT
          ? 'OVERHEAT'
          : current > OVERCURRENT_A
            ? 'OVERCURRENT'
            : 'NONE';
  }

  snapshot(cfg: RobotConfig): MotorChannel {
    return {
      rpm: (this.speed / cfg.wheelRadius) * (60 / (2 * Math.PI)),
      temperature: this.temperature,
      current: this.current,
      voltage: this.voltage,
      error: this.error,
    };
  }
}
