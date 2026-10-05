import {
  TOPICS,
  type AggregatedState,
  type AppConfig,
  type BatteryState,
  type Imu,
  type LaserScan,
  type MissionStatusMsg,
  type MotorStateMsg,
  type NavSatFix,
  type ObstacleSectors,
  type Odometry,
  type RobotTransport,
  type SensorHealth,
  type TopicMessage,
} from '@rover/protocol';
import { bodyExtent } from '@rover/robot-model';
import { geodeticToLocal } from '@rover/sensor-models';
import { deg2rad, quaternionToYaw, rad2deg, round, wrapAngle } from '@rover/shared';

const SECTORS: Array<[keyof ObstacleSectors, number, number]> = [
  ['front', -15, 15],
  ['frontLeft', 15, 60],
  ['frontRight', -60, -15],
  ['left', 60, 135],
  ['right', -135, -60],
];

/** Reduces a LaserScan to per-sector clearances from the rover body. */
export function computeSectors(scan: LaserScan, length: number, width: number): ObstacleSectors & { nearest: number } {
  const out: ObstacleSectors = { front: scan.range_max, frontLeft: scan.range_max, frontRight: scan.range_max, left: scan.range_max, right: scan.range_max };
  let nearest = scan.range_max;
  const bounds = SECTORS.map(([k, a, b]) => [k, deg2rad(a), deg2rad(b)] as const);
  for (let i = 0; i < scan.ranges.length; i++) {
    const angle = scan.angle_min + i * scan.angle_increment;
    const r = scan.ranges[i];
    if (!Number.isFinite(r)) continue;
    const clearance = Math.max(0, r - bodyExtent(angle, length, width));
    if (clearance < nearest) nearest = clearance;
    for (const [k, a, b] of bounds) {
      if (angle >= a && angle <= b && clearance < out[k]) out[k] = clearance;
    }
  }
  return { ...out, nearest };
}

/**
 * Subscribes to the sensor topics and condenses them into the compact AggregatedState
 * consumed by the decision engine. Works identically on simulated or ROS2 topics.
 */
export class StateAggregator {
  private scan?: TopicMessage<LaserScan>;
  private odom?: TopicMessage<Odometry>;
  private imu?: TopicMessage<Imu>;
  private gps?: TopicMessage<NavSatFix>;
  private battery?: TopicMessage<BatteryState>;
  private motors?: TopicMessage<MotorStateMsg>;
  private mission?: TopicMessage<MissionStatusMsg>;
  private unsubscribers: Array<() => void> = [];
  /** GPS correction applied on top of odometry (simple complementary filter). */
  private offset = { x: 0, y: 0 };
  private fusing = false;

  constructor(
    private readonly transport: RobotTransport,
    private readonly config: () => AppConfig,
  ) {
    this.unsubscribers.push(
      transport.subscribe<LaserScan>(TOPICS.scan, (m) => (this.scan = m)),
      transport.subscribe<Odometry>(TOPICS.odom, (m) => (this.odom = m)),
      transport.subscribe<Imu>(TOPICS.imu, (m) => (this.imu = m)),
      transport.subscribe<NavSatFix>(TOPICS.gps, (m) => this.onGps(m)),
      transport.subscribe<BatteryState>(TOPICS.battery, (m) => (this.battery = m)),
      transport.subscribe<MotorStateMsg>(TOPICS.motorState, (m) => (this.motors = m)),
      transport.subscribe<MissionStatusMsg>(TOPICS.mission, (m) => (this.mission = m)),
    );
  }

  reset(): void {
    this.scan = this.odom = this.imu = this.gps = this.battery = this.motors = this.mission = undefined;
    this.offset = { x: 0, y: 0 };
    this.fusing = false;
  }

  /** Bounds odometry drift by pulling the estimate toward GPS fixes. */
  private onGps(m: TopicMessage<NavSatFix>): void {
    this.gps = m;
    const odom = this.odom?.data;
    if (m.data.status.status !== 0 || !odom) {
      this.fusing = false;
      return;
    }
    const gpsCfg = this.config().sensors.gps;
    const local = geodeticToLocal(m.data.latitude, m.data.longitude, gpsCfg);
    const ex = local.x - (odom.pose.pose.position.x + this.offset.x);
    const ey = local.y - (odom.pose.pose.position.y + this.offset.y);
    // Gain ~ inverse of the expected noise; reject outliers.
    if (Math.hypot(ex, ey) > Math.max(5, gpsCfg.noise * 6)) return;
    const alpha = 0.04;
    this.offset.x += ex * alpha;
    this.offset.y += ey * alpha;
    this.fusing = true;
  }

  dispose(): void {
    for (const u of this.unsubscribers) u();
    this.unsubscribers = [];
  }

  private health(msg: TopicMessage | undefined, hz: number, simTime: number): SensorHealth {
    if (!msg) return 'MISSING';
    const timeout = Math.max(this.config().safety.sensorTimeout, hz > 0 ? 3 / hz : 1);
    return simTime - msg.simTime <= timeout ? 'OK' : 'STALE';
  }

  build(simTime: number): AggregatedState {
    const cfg = this.config();
    const s = cfg.sensors;
    const lidarHealth = this.health(this.scan, s.lidar.updateFrequency, simTime);
    const odomHealth = this.health(this.odom, s.odom.updateFrequency, simTime);
    const imuHealth = this.health(this.imu, s.imu.updateFrequency, simTime);
    const gpsHealth = this.health(this.gps, s.gps.updateFrequency, simTime);

    const o = this.odom?.data;
    const fused = this.fusing && gpsHealth === 'OK';
    const x = (o?.pose.pose.position.x ?? 0) + this.offset.x;
    const y = (o?.pose.pose.position.y ?? 0) + this.offset.y;
    const heading = o ? quaternionToYaw(o.pose.pose.orientation) : 0;
    const speed = o?.twist.twist.linear.x ?? 0;
    const angular = imuHealth === 'OK' && this.imu ? this.imu.data.angular_velocity.z : (o?.twist.twist.angular.z ?? 0);

    let obstacles: AggregatedState['obstacles'];
    if (this.scan) {
      const sec = computeSectors(this.scan.data, cfg.robot.length, cfg.robot.width);
      obstacles = {
        front: round(sec.front, 2),
        frontLeft: round(sec.frontLeft, 2),
        frontRight: round(sec.frontRight, 2),
        left: round(sec.left, 2),
        right: round(sec.right, 2),
        nearest: round(sec.nearest, 2),
        valid: lidarHealth === 'OK',
      };
    } else {
      obstacles = { front: 0, frontLeft: 0, frontRight: 0, left: 0, right: 0, nearest: 0, valid: false };
    }

    const mission = this.mission?.data;
    const rel = (gx: number, gy: number) => ({
      distance: round(Math.hypot(gx - x, gy - y), 2),
      bearing: round(rad2deg(wrapAngle(Math.atan2(gy - y, gx - x) - heading)), 1),
    });
    const goal = mission?.goal ?? null;
    const home = mission?.home ?? { x: 0, y: 0 };

    const b = this.battery?.data;
    const m = this.motors?.data;
    const fix = gpsHealth === 'OK' && this.gps?.data.status.status === 0;

    return {
      timestamp: Date.now(),
      simTime: round(simTime, 3),
      robot: { x: round(x, 2), y: round(y, 2), heading: round(rad2deg(heading), 1), speed: round(speed, 2), angularVelocity: round(angular, 3), localization: fused ? 'odom+gps' : 'odom' },
      obstacles,
      target: goal ? { x: goal.x, y: goal.y, ...rel(goal.x, goal.y) } : null,
      home: rel(home.x, home.y),
      battery: {
        percentage: b ? round(b.percentage * 100, 1) : 0,
        voltage: b ? round(b.voltage, 2) : 0,
        state: b ? b.power_supply_health : 'DEAD',
      },
      motors: {
        left: !m ? 'OK' : m.leftMotor.error === 'NONE' ? 'OK' : m.leftMotor.error,
        right: !m ? 'OK' : m.rightMotor.error === 'NONE' ? 'OK' : m.rightMotor.error,
        maxTemperature: m ? round(Math.max(m.leftMotor.temperature, m.rightMotor.temperature), 1) : 25,
      },
      gps: {
        fix,
        latitude: fix && this.gps ? round(this.gps.data.latitude, 7) : null,
        longitude: fix && this.gps ? round(this.gps.data.longitude, 7) : null,
      },
      mission: { state: mission?.state ?? 'IDLE', goalIndex: mission?.goalIndex ?? 0, goalCount: mission?.goalCount ?? 0, tolerance: mission?.tolerance ?? 0.5 },
      sensors: { lidar: lidarHealth, imu: imuHealth, odom: odomHealth, gps: gpsHealth },
    };
  }
}
