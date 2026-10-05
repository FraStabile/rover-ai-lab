import type { AppConfig, MotorStateMsg, BatteryState } from '@rover/protocol';
import { BatteryModel, MotorModel, cmdVelToWheelTargets, collisionRadius, diffDriveForward } from '@rover/robot-model';
import { clamp, wrapAngle } from '@rover/shared';
import type { CollisionDetector, CollisionResult } from './world';

export interface StepOutcome {
  collision: CollisionResult | null;
  /** True on the first tick of a contact. */
  newCollision: boolean;
}

/**
 * The simulated physical rover: diff-drive controller (cmd_vel → wheel set-points),
 * two motors, battery and rigid body kinematics with collision handling.
 */
export class SimulatedRover {
  x = 0;
  y = 0;
  heading = 0;
  linear = 0;
  angular = 0;
  acceleration = 0;
  readonly left = new MotorModel();
  readonly right = new MotorModel();
  readonly battery: BatteryModel;
  cmd = { linear: 0, angular: 0, stamp: -Infinity };
  inContact = false;
  collisions = 0;
  odometerM = 0;

  constructor(private cfg: AppConfig) {
    this.battery = new BatteryModel(cfg.battery);
  }

  reset(x: number, y: number, headingRad: number, cfg: AppConfig, initialBattery?: number): void {
    this.cfg = cfg;
    this.x = x;
    this.y = y;
    this.heading = wrapAngle(headingRad);
    this.linear = 0;
    this.angular = 0;
    this.acceleration = 0;
    this.left.reset();
    this.right.reset();
    this.battery.reset(cfg.battery, initialBattery ?? cfg.battery.initialCharge);
    this.cmd = { linear: 0, angular: 0, stamp: -Infinity };
    this.inContact = false;
    this.collisions = 0;
    this.odometerM = 0;
  }

  /** /cmd_vel subscriber callback. */
  applyCmdVel(linear: number, angular: number, simTime: number): void {
    this.cmd = { linear: Number.isFinite(linear) ? linear : 0, angular: Number.isFinite(angular) ? angular : 0, stamp: simTime };
  }

  step(dt: number, simTime: number, collisions: CollisionDetector): StepOutcome {
    const { robot, failures, simulation } = this.cfg;
    // Watchdog: without fresh commands the controller brings the robot to a halt.
    const fresh = simTime - this.cmd.stamp <= simulation.cmdVelTimeout;
    const target = fresh ? cmdVelToWheelTargets(this.cmd.linear, this.cmd.angular, robot) : { left: 0, right: 0 };
    const supply = this.battery.dead ? 0 : this.battery.voltage;
    this.left.update(target.left, dt, robot, failures.leftMotor, supply);
    this.right.update(target.right, dt, robot, failures.rightMotor, supply);

    const prevLinear = this.linear;
    const tw = diffDriveForward(this.left.speed, this.right.speed, robot.wheelBase);
    this.linear = tw.linear;
    this.angular = clamp(tw.angular, -robot.maxAngularVelocity * 1.2, robot.maxAngularVelocity * 1.2);
    this.acceleration = (this.linear - prevLinear) / dt;

    const mid = this.heading + (this.angular * dt) / 2;
    const nx = this.x + this.linear * Math.cos(mid) * dt;
    const ny = this.y + this.linear * Math.sin(mid) * dt;
    this.heading = wrapAngle(this.heading + this.angular * dt);

    const r = collisionRadius(robot);
    const hit = collisions.checkCircle(nx, ny, r);
    let newCollision = false;
    if (hit.collides && (nx !== this.x || ny !== this.y)) {
      // Rigid contact: the body does not penetrate; wheels stall.
      newCollision = !this.inContact;
      if (newCollision) this.collisions++;
      this.inContact = true;
      this.left.speed = 0;
      this.right.speed = 0;
      this.acceleration = (0 - prevLinear) / dt;
      this.linear = 0;
    } else {
      this.odometerM += Math.hypot(nx - this.x, ny - this.y);
      this.x = nx;
      this.y = ny;
      // Contact hysteresis: the last free pose can be up to one step away from the obstacle.
      const stillTouching = collisions.checkCircle(nx, ny, r + Math.max(0.05, Math.abs(this.linear) * dt * 2)).collides;
      this.inContact = stillTouching && this.inContact;
    }

    const motorCurrent = this.left.current + this.right.current;
    this.battery.setConfig(this.cfg.battery);
    this.battery.update(dt, this.linear, this.angular, robot, failures.batteryDrain, motorCurrent);
    return { collision: hit.collides ? hit : null, newCollision };
  }

  setConfig(cfg: AppConfig): void {
    this.cfg = cfg;
  }

  motorState(stamp: number, seq: number): MotorStateMsg {
    return {
      header: { stamp, frame_id: 'base_link', seq },
      leftMotor: this.left.snapshot(this.cfg.robot),
      rightMotor: this.right.snapshot(this.cfg.robot),
    };
  }

  batteryState(stamp: number, seq: number): BatteryState {
    const b = this.battery;
    return {
      header: { stamp, frame_id: 'battery', seq },
      voltage: b.voltage,
      current: b.current,
      charge: b.energyWh,
      capacity: this.cfg.battery.capacity,
      percentage: b.soc,
      remaining_time: Number.isFinite(b.remainingTime) ? b.remainingTime : -1,
      power_supply_status: b.soc >= 0.999 ? 'FULL' : b.dead ? 'NOT_CHARGING' : 'DISCHARGING',
      power_supply_health: b.health,
    };
  }
}
