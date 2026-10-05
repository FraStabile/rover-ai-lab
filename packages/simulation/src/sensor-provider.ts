import { MSG_TYPES, TOPICS, type AppConfig, type NavSatFix, type RobotTransport, type SensorProvider } from '@rover/protocol';
import type { EventLogger } from '@rover/logging';
import { ImuSensor, OdometrySensor, simulateGps, simulateLaserScan } from '@rover/sensor-models';
import { Rng } from '@rover/shared';
import type { SimulatedRover } from './rover';
import type { World } from './world';

interface Channel {
  topic: string;
  rate: () => number;
  next: number;
  seq: number;
}

/**
 * Generates every sensor topic from the simulated world and publishes it on the transport
 * at its own configured rate. A ROS2SensorProvider would replace this class on the real rover.
 */
export class SimulationSensorProvider implements SensorProvider {
  readonly name = 'SimulationSensorProvider';
  readonly odom = new OdometrySensor();
  private readonly imu = new ImuSensor();
  private rngs!: Record<'lidar' | 'imu' | 'odom' | 'gps', Rng>;
  private channels: Channel[] = [];
  private lastTime = 0;
  private lastFailures = { lidar: false, imu: false, gps: false, odom: false };
  readonly publishCounts: Record<string, number> = {};

  constructor(
    private readonly transport: RobotTransport,
    private readonly rover: SimulatedRover,
    private world: World,
    private cfg: AppConfig,
    private readonly logger: EventLogger,
  ) {
    const s = cfg.sensors;
    transport.advertise(TOPICS.scan, MSG_TYPES.LaserScan, '/lidar_driver', s.lidar.updateFrequency);
    transport.advertise(TOPICS.imu, MSG_TYPES.Imu, '/imu_driver', s.imu.updateFrequency);
    transport.advertise(TOPICS.odom, MSG_TYPES.Odometry, '/diff_drive_controller', s.odom.updateFrequency);
    transport.advertise(TOPICS.gps, MSG_TYPES.NavSatFix, '/gps_driver', s.gps.updateFrequency);
    transport.advertise(TOPICS.battery, MSG_TYPES.BatteryState, '/bms', s.batteryFrequency);
    transport.advertise(TOPICS.motorState, MSG_TYPES.MotorState, '/motor_driver', s.motorFrequency);
    this.reset();
  }

  setWorld(world: World): void {
    this.world = world;
  }

  setConfig(cfg: AppConfig): void {
    this.cfg = cfg;
    this.readvertise();
  }

  reset(): void {
    const seed = this.cfg.simulation.seed;
    this.rngs = {
      lidar: Rng.derive(seed, 'lidar'),
      imu: Rng.derive(seed, 'imu'),
      odom: Rng.derive(seed, 'odom'),
      gps: Rng.derive(seed, 'gps'),
    };
    this.imu.reset();
    this.odom.reset(this.rover.x, this.rover.y, this.rover.heading);
    const s = () => this.cfg.sensors;
    this.channels = [
      { topic: TOPICS.scan, rate: () => s().lidar.updateFrequency, next: 0, seq: 0 },
      { topic: TOPICS.imu, rate: () => s().imu.updateFrequency, next: 0, seq: 0 },
      { topic: TOPICS.odom, rate: () => s().odom.updateFrequency, next: 0, seq: 0 },
      { topic: TOPICS.gps, rate: () => s().gps.updateFrequency, next: 0, seq: 0 },
      { topic: TOPICS.battery, rate: () => s().batteryFrequency, next: 0, seq: 0 },
      { topic: TOPICS.motorState, rate: () => s().motorFrequency, next: 0, seq: 0 },
    ];
    this.lastTime = 0;
    this.lastFailures = { lidar: false, imu: false, gps: false, odom: false };
    for (const k of Object.keys(this.publishCounts)) delete this.publishCounts[k];
    this.readvertise();
  }

  /** Must be called after every physics step. */
  update(simTime: number): void {
    const dt = Math.max(0, simTime - this.lastTime);
    this.lastTime = simTime;
    const noise = this.cfg.failures.sensorNoiseMultiplier;
    // Encoders integrate continuously; only the publication is rate-limited.
    this.odom.integrate(this.rover.left.speed, this.rover.right.speed, this.cfg.robot.wheelBase, dt, this.cfg.sensors.odom, this.rngs.odom, noise);
    this.reportFailureTransitions();

    for (const ch of this.channels) {
      const hz = ch.rate();
      if (hz <= 0) continue;
      if (simTime + 1e-9 < ch.next) continue;
      const period = 1 / hz;
      ch.next = ch.next + period < simTime ? simTime + period : ch.next + period;
      this.publishChannel(ch, simTime, period);
    }
  }

  private publishChannel(ch: Channel, t: number, period: number): void {
    const { sensors, failures } = this.cfg;
    const noise = failures.sensorNoiseMultiplier;
    const pose = { x: this.rover.x, y: this.rover.y, heading: this.rover.heading };
    let data: unknown;
    switch (ch.topic) {
      case TOPICS.scan:
        if (!sensors.lidar.enabled || failures.lidar) return;
        data = simulateLaserScan(this.world, pose, sensors.lidar, this.rngs.lidar, noise, t, ch.seq);
        break;
      case TOPICS.imu:
        if (!sensors.imu.enabled || failures.imu) return;
        data = this.imu.measure(
          { heading: pose.heading, angularVelocity: this.rover.angular, longitudinalAccel: this.rover.acceleration, linearVelocity: this.rover.linear },
          sensors.imu,
          this.rngs.imu,
          noise,
          period,
          t,
          ch.seq,
        );
        break;
      case TOPICS.odom:
        if (!sensors.odom.enabled || failures.odom) return;
        data = this.odom.message(t, ch.seq);
        break;
      case TOPICS.gps:
        if (!sensors.gps.enabled) return;
        if (failures.gps) {
          const lost: NavSatFix = {
            header: { stamp: t, frame_id: 'gps', seq: ch.seq },
            status: { status: -1, service: 1 },
            latitude: 0,
            longitude: 0,
            altitude: 0,
            position_covariance: [],
          };
          data = lost;
        } else {
          data = simulateGps(pose.x, pose.y, sensors.gps, this.rngs.gps, noise, t, ch.seq);
        }
        break;
      case TOPICS.battery:
        data = this.rover.batteryState(t, ch.seq);
        break;
      case TOPICS.motorState:
        data = this.rover.motorState(t, ch.seq);
        break;
      default:
        return;
    }
    ch.seq++;
    this.publishCounts[ch.topic] = (this.publishCounts[ch.topic] ?? 0) + 1;
    this.transport.publish(ch.topic, data);
    if (this.cfg.simulation.verboseSensorLogs) {
      this.logger.debug('SENSOR_UPDATE', 'SimulationSensorProvider', `${ch.topic} update #${ch.seq}`);
    }
  }

  private reportFailureTransitions(): void {
    const f = this.cfg.failures;
    for (const key of ['lidar', 'imu', 'gps', 'odom'] as const) {
      if (f[key] !== this.lastFailures[key]) {
        this.lastFailures[key] = f[key];
        if (f[key]) this.logger.warn('SENSOR_FAILURE', 'SimulationSensorProvider', `${key.toUpperCase()} failure injected`);
        else this.logger.info('SENSOR_UPDATE', 'SimulationSensorProvider', `${key.toUpperCase()} restored`);
      }
    }
  }

  private readvertise(): void {
    const s = this.cfg.sensors;
    this.transport.advertise(TOPICS.scan, MSG_TYPES.LaserScan, '/lidar_driver', s.lidar.updateFrequency);
    this.transport.advertise(TOPICS.imu, MSG_TYPES.Imu, '/imu_driver', s.imu.updateFrequency);
    this.transport.advertise(TOPICS.odom, MSG_TYPES.Odometry, '/diff_drive_controller', s.odom.updateFrequency);
    this.transport.advertise(TOPICS.gps, MSG_TYPES.NavSatFix, '/gps_driver', s.gps.updateFrequency);
    this.transport.advertise(TOPICS.battery, MSG_TYPES.BatteryState, '/bms', s.batteryFrequency);
    this.transport.advertise(TOPICS.motorState, MSG_TYPES.MotorState, '/motor_driver', s.motorFrequency);
  }
}
