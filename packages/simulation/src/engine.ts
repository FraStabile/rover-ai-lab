import { TOPICS, type AppConfig, type CmdVel, type MotorError, type RobotTransport, type Scenario } from '@rover/protocol';
import type { EventLogger } from '@rover/logging';
import { deg2rad } from '@rover/shared';
import { MissionManager } from './mission';
import { SimulatedRover } from './rover';
import { SimulationSensorProvider } from './sensor-provider';
import { CollisionDetector, World } from './world';

export interface SimulationEngineOptions {
  transport: RobotTransport;
  logger: EventLogger;
  config: AppConfig;
  scenario: Scenario;
}

export interface EngineStepResult {
  newCollision: boolean;
  collisionWith: string | null;
}

/**
 * The simulated robot + world. Talks to the rest of the system only through the transport:
 * it publishes sensor topics and subscribes to /cmd_vel, exactly like the physical rover would.
 */
export class SimulationEngine {
  simTime = 0;
  tick = 0;
  world: World;
  collisions: CollisionDetector;
  readonly rover: SimulatedRover;
  readonly sensors: SimulationSensorProvider;
  readonly mission: MissionManager;
  scenario: Scenario;
  private cfg: AppConfig;
  private lastBatteryHealth = 'GOOD';
  private lastMotorErrors: { left: MotorError; right: MotorError } = { left: 'NONE', right: 'NONE' };
  private readonly transport: RobotTransport;
  private readonly logger: EventLogger;

  constructor(opts: SimulationEngineOptions) {
    this.transport = opts.transport;
    this.logger = opts.logger;
    this.cfg = opts.config;
    this.scenario = opts.scenario;
    this.world = new World(opts.scenario);
    this.collisions = new CollisionDetector(this.world);
    this.rover = new SimulatedRover(this.cfg);
    this.mission = new MissionManager(this.transport, this.logger);
    this.resetRover();
    this.sensors = new SimulationSensorProvider(this.transport, this.rover, this.world, this.cfg, this.logger);
    this.mission.load(opts.scenario);

    // Robot-side diff drive controller node: /cmd_vel → wheel set-points.
    this.transport.subscribe<CmdVel>(TOPICS.cmdVel, (msg) => {
      this.rover.applyCmdVel(msg.data.linear.x, msg.data.angular.z, msg.simTime);
    });
  }

  loadScenario(scenario: Scenario, cfg: AppConfig): void {
    this.scenario = scenario;
    this.cfg = cfg;
    this.world = new World(scenario);
    this.collisions = new CollisionDetector(this.world);
    this.sensors.setWorld(this.world);
    this.reset(cfg);
  }

  reset(cfg: AppConfig): void {
    this.cfg = cfg;
    this.simTime = 0;
    this.tick = 0;
    this.rover.setConfig(cfg);
    this.resetRover();
    this.sensors.setConfig(cfg);
    this.sensors.reset();
    this.mission.load(this.scenario);
    this.lastBatteryHealth = this.rover.battery.health;
    this.lastMotorErrors = { left: 'NONE', right: 'NONE' };
  }

  setConfig(cfg: AppConfig): void {
    this.cfg = cfg;
    this.rover.setConfig(cfg);
    this.sensors.setConfig(cfg);
  }

  /** Advances physics by dt, then lets sensors publish. */
  step(dt: number): EngineStepResult {
    this.tick++;
    const t = this.simTime + dt;
    const out = this.rover.step(dt, t, this.collisions);
    this.simTime = t;
    if (out.newCollision) {
      this.logger.warn('COLLISION', 'PhysicsEngine', `Collision with ${out.collision?.with ?? 'unknown'} at (${this.rover.x.toFixed(2)}, ${this.rover.y.toFixed(2)})`, {
        with: out.collision?.with,
        x: this.rover.x,
        y: this.rover.y,
      });
    }
    this.sensors.update(t);
    this.mission.update(t, dt, this.rover.x, this.rover.y, { batteryDead: this.rover.battery.dead, newCollision: out.newCollision });
    this.reportHealthTransitions();
    return { newCollision: out.newCollision, collisionWith: out.collision?.with ?? null };
  }

  private resetRover(): void {
    const s = this.scenario;
    this.rover.reset(s.rover.x, s.rover.y, deg2rad(s.rover.heading), this.cfg, s.initialBattery);
  }

  private reportHealthTransitions(): void {
    const h = this.rover.battery.health;
    if (h !== this.lastBatteryHealth) {
      const pct = this.rover.battery.percentage.toFixed(1);
      if (h === 'LOW') this.logger.warn('BATTERY_WARNING', 'BatteryModel', `LOW_BATTERY: ${pct}%`, { percentage: this.rover.battery.percentage });
      else if (h === 'CRITICAL') this.logger.warn('BATTERY_CRITICAL', 'BatteryModel', `Battery critical: ${pct}%`, { percentage: this.rover.battery.percentage });
      else if (h === 'DEAD') this.logger.log({ type: 'BATTERY_CRITICAL', source: 'BatteryModel', message: 'Battery depleted', level: 'error' });
      this.lastBatteryHealth = h;
    }
    for (const side of ['left', 'right'] as const) {
      const err = this.rover[side].error;
      if (err !== this.lastMotorErrors[side]) {
        if (err !== 'NONE') this.logger.warn('MOTOR_FAULT', 'MotorDriver', `${side} motor: ${err}`, { side, error: err, temperature: this.rover[side].temperature });
        else this.logger.info('MOTOR_FAULT', 'MotorDriver', `${side} motor fault cleared`);
        this.lastMotorErrors[side] = err;
      }
    }
  }
}
