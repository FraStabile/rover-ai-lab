import type { BatteryConfig, RobotConfig } from '@rover/protocol';

export type BatteryHealth = 'GOOD' | 'LOW' | 'CRITICAL' | 'DEAD';

/** Energy-based battery model with a simple open-circuit voltage curve and load sag. */
export class BatteryModel {
  energyWh: number;
  power = 0;
  voltage = 0;
  current = 0;

  constructor(private cfg: BatteryConfig) {
    this.energyWh = cfg.capacity * cfg.initialCharge;
    this.voltage = this.openCircuitVoltage();
  }

  reset(cfg: BatteryConfig, initialCharge = cfg.initialCharge): void {
    this.cfg = cfg;
    this.energyWh = cfg.capacity * Math.max(0, Math.min(1, initialCharge));
    this.power = 0;
    this.current = 0;
    this.voltage = this.openCircuitVoltage();
  }

  setConfig(cfg: BatteryConfig): void {
    // Keep the state of charge when the capacity is changed live.
    const soc = this.soc;
    this.cfg = cfg;
    this.energyWh = soc * cfg.capacity;
  }

  get soc(): number {
    return this.cfg.capacity > 0 ? Math.max(0, Math.min(1, this.energyWh / this.cfg.capacity)) : 0;
  }

  get percentage(): number {
    return this.soc * 100;
  }

  get dead(): boolean {
    return this.energyWh <= 0;
  }

  get health(): BatteryHealth {
    const s = this.soc;
    if (s <= 0) return 'DEAD';
    if (s < this.cfg.criticalThreshold) return 'CRITICAL';
    if (s < this.cfg.lowThreshold) return 'LOW';
    return 'GOOD';
  }

  /** Remaining time (s) at the current power draw. */
  get remainingTime(): number {
    return this.power > 0 ? (this.energyWh / this.power) * 3600 : Infinity;
  }

  update(dt: number, linear: number, angular: number, robot: RobotConfig, drainMultiplier: number, motorCurrent: number): void {
    if (this.dead) {
      this.power = 0;
      this.current = 0;
      this.voltage = 0;
      return;
    }
    const c = this.cfg;
    const moving = robot.maxSpeed > 0 ? Math.min(1, Math.abs(linear) / robot.maxSpeed) : 0;
    const turning = robot.maxAngularVelocity > 0 ? Math.min(1, Math.abs(angular) / robot.maxAngularVelocity) : 0;
    const ocv = this.openCircuitVoltage();
    // Motor currents beyond the nominal model (e.g. high-current faults) draw extra power.
    const extra = Math.max(0, motorCurrent - 6) * ocv * 0.5;
    this.power = (c.consumptionIdle + c.consumptionMoving * moving + c.consumptionTurning * turning + extra) * c.consumptionMultiplier * drainMultiplier;
    this.energyWh = Math.max(0, this.energyWh - (this.power * dt) / 3600);
    this.current = ocv > 0 ? this.power / ocv : 0;
    this.voltage = this.dead ? 0 : Math.max(0, ocv - this.current * 0.05);
  }

  private openCircuitVoltage(): number {
    const s = this.soc;
    if (s <= 0) return 0;
    const full = this.cfg.nominalVoltage * 1.05;
    const empty = this.cfg.nominalVoltage * 0.875;
    // Flat plateau with a knee under 10%.
    const knee = s < 0.1 ? (0.1 - s) * 4 : 0;
    return Math.max(empty * 0.9, empty + (full - empty) * Math.pow(s, 0.7) - knee);
  }
}
