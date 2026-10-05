export interface RobotConfig {
  /** kg */
  mass: number;
  /** m/s */
  maxSpeed: number;
  /** m/s² */
  maxAcceleration: number;
  /** rad/s */
  maxAngularVelocity: number;
  /** Fraction (0..1) of maxAngularVelocity used by the planner for turn actions. */
  turnRate: number;
  /** Distance between wheels (m). */
  wheelBase: number;
  /** m */
  wheelRadius: number;
  /** Body length (m), x axis. */
  length: number;
  /** Body width (m), y axis. */
  width: number;
  /** Rolling resistance coefficient: fraction of speed lost per second. */
  friction: number;
}

export interface BatteryConfig {
  /** Wh */
  capacity: number;
  /** Initial state of charge 0..1 */
  initialCharge: number;
  /** W when idle (electronics). */
  consumptionIdle: number;
  /** W at max linear speed. */
  consumptionMoving: number;
  /** W at max angular velocity. */
  consumptionTurning: number;
  /** Global multiplier (1 = nominal). */
  consumptionMultiplier: number;
  nominalVoltage: number;
  /** Fraction below which LOW_BATTERY is raised. */
  lowThreshold: number;
  /** Fraction below which the safety layer stops the rover. */
  criticalThreshold: number;
}

export interface LidarConfig {
  enabled: boolean;
  /** m */
  range: number;
  rangeMin: number;
  /** degrees */
  fieldOfView: number;
  numberOfRays: number;
  /** Hz */
  updateFrequency: number;
  /** std dev, m */
  noise: number;
  /** Probability that a ray returns nothing. */
  dropout: number;
}

export interface ImuConfig {
  enabled: boolean;
  updateFrequency: number;
  accelNoise: number;
  gyroNoise: number;
  orientationNoise: number;
  gyroBias: number;
}

export interface OdomConfig {
  enabled: boolean;
  updateFrequency: number;
  /** Relative wheel encoder noise (fraction of wheel travel). */
  noise: number;
}

export interface GpsConfig {
  enabled: boolean;
  updateFrequency: number;
  /** Horizontal std dev in metres. */
  noise: number;
  originLatitude: number;
  originLongitude: number;
  altitude: number;
}

export interface SensorsConfig {
  lidar: LidarConfig;
  imu: ImuConfig;
  odom: OdomConfig;
  gps: GpsConfig;
  batteryFrequency: number;
  motorFrequency: number;
}

export type AiProvider = 'mock' | 'local-jev' | 'custom-http';

export type JevProtocol = 'systemone' | 'native' | 'openai-chat';

export const DEFAULT_JEV_INSTRUCTIONS = [
  'You are the driving policy of a small ground rover. The state is JSON.',
  'obstacles.front, frontLeft, frontRight, left and right are free distances in metres from the rover body.',
  'target.bearing is the angle to the target in degrees: positive means the target is to the LEFT, negative to the RIGHT. target.distance is in metres.',
  'Rules, in order: if mission.state is not RUNNING or obstacles.valid is false, choose STOP.',
  'If target.distance is below mission.tolerance, choose STOP.',
  'If battery.percentage is below 15, choose RETURN_HOME.',
  'If obstacles.front is below 1.2, turn toward the side with more free space: TURN_LEFT if frontLeft is larger than frontRight, otherwise TURN_RIGHT.',
  'If target.bearing is above 45 choose TURN_LEFT; if it is below -45 choose TURN_RIGHT.',
  'If obstacles.front is below 2.5 choose SLOW_DOWN. Otherwise choose REACH_TARGET.',
  'Which action should the rover take now?',
].join(' ');

export interface JevConfig {
  enabled: boolean;
  baseUrl: string;
  model: string;
  /**
   * 'systemone': jevos / Jev wire format (POST /v1/systemone, a `choice` question over the actions).
   * 'native': posts the state and expects {action, confidence, reason}.
   * 'openai-chat': OpenAI compatible /v1/chat/completions.
   */
  protocol: JevProtocol;
  /** Empty = the protocol's default path. */
  decidePath: string;
  healthPath: string;
  /** systemone only: the decision policy written into the question (jevos reads the rule from the question). */
  instructions: string;
  /** Optional header values (no secrets are stored in the repository). */
  headers: Record<string, string>;
  temperature: number;
}

export interface CustomHttpConfig {
  url: string;
  method: 'POST' | 'PUT' | 'GET';
  headers: Record<string, string>;
  /** JSON template; placeholders: {{state}}, {{model}}, {{actions}}, {{state.robot.x}}… */
  requestTemplate: string;
  responseMapping: {
    action: string;
    confidence: string;
    reason: string;
  };
  /** Maps provider-specific action strings to internal actions, e.g. {"left":"TURN_LEFT"}. */
  actionMap: Record<string, string>;
  healthUrl: string;
}

export interface AiConfig {
  provider: AiProvider;
  decisionIntervalMs: number;
  timeoutMs: number;
  retries: number;
  /** A decision older than this (sim ms) is treated as AI_TIMEOUT. */
  staleAfterMs: number;
  /** realtime: sim never waits for AI. lockstep: sim waits for each decision (deterministic with deterministic models). */
  syncMode: 'realtime' | 'lockstep';
  jev: JevConfig;
  custom: CustomHttpConfig;
}

export interface SafetyConfig {
  /** Clearance (m) under which forward motion becomes EMERGENCY_STOP. */
  emergencyStopDistance: number;
  /** Clearance (m) under which speed is scaled down. */
  slowDownDistance: number;
  slowDownFactor: number;
  /** s; forward motion with time-to-collision under this is blocked. */
  timeToCollision: number;
  maxSpeed: number;
  maxAngularVelocity: number;
  onAiTimeout: 'STOP' | 'SLOW_DOWN' | 'CONTINUE_LAST';
  motorTemperatureLimit: number;
  /** Max age (s) of LiDAR data before SENSOR_FAILURE. */
  sensorTimeout: number;
  applyInManual: boolean;
}

export interface PlannerConfig {
  cruiseSpeed: number;
  slowSpeed: number;
  turnLinearSpeed: number;
  reverseSpeed: number;
  headingGain: number;
  /** Rate of /cmd_vel publication (Hz). */
  controlFrequency: number;
}

export interface SimulationConfig {
  /** Physics rate (Hz). */
  hz: number;
  /** Time scale (1 = realtime, 0.25 slow motion, 10 fast forward). */
  speed: number;
  seed: number;
  /** Rate of UI frame broadcast (Hz). */
  uiFrequency: number;
  /** Rate of recorded telemetry frames (Hz). */
  recordFrequency: number;
  /** Log every sensor publication (very verbose). */
  verboseSensorLogs: boolean;
  /** Robot stops if no /cmd_vel for this long (s). */
  cmdVelTimeout: number;
}

export type MotorFault = 'none' | 'failure' | 'overheat' | 'high_current';

export interface FailureConfig {
  lidar: boolean;
  gps: boolean;
  imu: boolean;
  odom: boolean;
  leftMotor: MotorFault;
  rightMotor: MotorFault;
  /** Battery drain multiplier (1 = nominal). */
  batteryDrain: number;
  aiTimeout: boolean;
  aiInvalidResponse: boolean;
  /** Injected AI inference latency (ms). */
  aiLatencyMs: number;
  /** Injected network latency (ms) with ±30% jitter. */
  networkLatencyMs: number;
  /** Multiplier applied to all sensor noise. */
  sensorNoiseMultiplier: number;
}

export type DevMode = 'SIMULATION' | 'SIMULATION_LOCAL_AI' | 'REAL_ROBOT';
export type ControlMode = 'MANUAL' | 'AUTO';

export interface AppConfig {
  robot: RobotConfig;
  battery: BatteryConfig;
  sensors: SensorsConfig;
  ai: AiConfig;
  safety: SafetyConfig;
  planner: PlannerConfig;
  simulation: SimulationConfig;
  failures: FailureConfig;
}

export const SIM_RATES = [10, 20, 30, 50, 100] as const;
export const AI_INTERVALS_MS = [100, 250, 500, 1000, 2000] as const;
export const SIM_SPEEDS = [0.1, 0.25, 0.5, 1, 2, 5, 10] as const;

export const DEFAULT_CUSTOM_TEMPLATE = JSON.stringify(
  { model: '{{model}}', input: '{{state}}', allowed_actions: '{{actions}}' },
  null,
  2,
);

export function createDefaultConfig(): AppConfig {
  return {
    robot: {
      mass: 25,
      maxSpeed: 2.0,
      maxAcceleration: 1.0,
      maxAngularVelocity: 1.5,
      turnRate: 0.55,
      wheelBase: 0.5,
      wheelRadius: 0.1,
      length: 0.7,
      width: 0.5,
      friction: 0.05,
    },
    battery: {
      capacity: 100,
      initialCharge: 1,
      consumptionIdle: 5,
      consumptionMoving: 60,
      consumptionTurning: 20,
      consumptionMultiplier: 1,
      nominalVoltage: 24,
      lowThreshold: 0.15,
      criticalThreshold: 0.05,
    },
    sensors: {
      lidar: {
        enabled: true,
        range: 10,
        rangeMin: 0.1,
        fieldOfView: 270,
        numberOfRays: 180,
        updateFrequency: 20,
        noise: 0.01,
        dropout: 0,
      },
      imu: { enabled: true, updateFrequency: 50, accelNoise: 0.05, gyroNoise: 0.01, orientationNoise: 0.005, gyroBias: 0.001 },
      odom: { enabled: true, updateFrequency: 50, noise: 0.005 },
      gps: { enabled: true, updateFrequency: 5, noise: 0.5, originLatitude: 45.4642, originLongitude: 9.19, altitude: 120 },
      batteryFrequency: 1,
      motorFrequency: 10,
    },
    ai: {
      provider: 'mock',
      decisionIntervalMs: 500,
      timeoutMs: 1000,
      retries: 0,
      staleAfterMs: 2000,
      syncMode: 'realtime',
      jev: {
        enabled: false,
        baseUrl: 'http://127.0.0.1:8017',
        model: 'jev-latest',
        protocol: 'systemone',
        decidePath: '',
        healthPath: '',
        instructions: DEFAULT_JEV_INSTRUCTIONS,
        headers: {},
        temperature: 0,
      },
      custom: {
        url: 'http://localhost:8000/decide',
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        requestTemplate: DEFAULT_CUSTOM_TEMPLATE,
        responseMapping: { action: 'action', confidence: 'confidence', reason: 'reason' },
        actionMap: {},
        healthUrl: '',
      },
    },
    safety: {
      emergencyStopDistance: 0.5,
      slowDownDistance: 1.5,
      slowDownFactor: 0.4,
      timeToCollision: 1.2,
      maxSpeed: 2.0,
      maxAngularVelocity: 1.5,
      onAiTimeout: 'STOP',
      motorTemperatureLimit: 85,
      sensorTimeout: 0.5,
      applyInManual: true,
    },
    planner: {
      cruiseSpeed: 1.0,
      slowSpeed: 0.4,
      turnLinearSpeed: 0.25,
      reverseSpeed: 0.3,
      headingGain: 1.5,
      controlFrequency: 20,
    },
    simulation: {
      hz: 50,
      speed: 1,
      seed: 12345,
      uiFrequency: 20,
      recordFrequency: 10,
      verboseSensorLogs: false,
      cmdVelTimeout: 0.5,
    },
    failures: createDefaultFailures(),
  };
}

export function createDefaultFailures(): FailureConfig {
  return {
    lidar: false,
    gps: false,
    imu: false,
    odom: false,
    leftMotor: 'none',
    rightMotor: 'none',
    batteryDrain: 1,
    aiTimeout: false,
    aiInvalidResponse: false,
    aiLatencyMs: 0,
    networkLatencyMs: 0,
    sensorNoiseMultiplier: 1,
  };
}

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends readonly unknown[] ? T[K] : T[K] extends object ? DeepPartial<T[K]> : T[K];
};
