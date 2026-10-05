/**
 * ROS2-like message definitions.
 *
 * Field names intentionally mirror the ROS2 message definitions (snake_case)
 * so that a future ROS2Transport can map 1:1 to sensor_msgs / nav_msgs / geometry_msgs.
 * Time stamps are expressed in seconds of *simulation time* (or ROS time on a real robot).
 */

export interface Header {
  /** Seconds (sim time on the simulator, ROS clock on a real robot). */
  stamp: number;
  frame_id: string;
  seq: number;
}

export interface Vector3 {
  x: number;
  y: number;
  z: number;
}

export interface Quaternion {
  x: number;
  y: number;
  z: number;
  w: number;
}

export interface Pose {
  position: Vector3;
  orientation: Quaternion;
}

export interface Twist {
  linear: Vector3;
  angular: Vector3;
}

/** sensor_msgs/LaserScan */
export interface LaserScan {
  header: Header;
  angle_min: number;
  angle_max: number;
  angle_increment: number;
  time_increment: number;
  scan_time: number;
  range_min: number;
  range_max: number;
  /** Values >= range_max mean "no return". */
  ranges: number[];
  intensities: number[];
}

/** sensor_msgs/Imu */
export interface Imu {
  header: Header;
  orientation: Quaternion;
  angular_velocity: Vector3;
  linear_acceleration: Vector3;
}

/** nav_msgs/Odometry */
export interface Odometry {
  header: Header;
  child_frame_id: string;
  pose: { pose: Pose };
  twist: { twist: Twist };
}

/** sensor_msgs/NavSatFix (status: -1 NO_FIX, 0 FIX) */
export interface NavSatFix {
  header: Header;
  status: { status: -1 | 0; service: number };
  latitude: number;
  longitude: number;
  altitude: number;
  position_covariance: number[];
}

/** sensor_msgs/BatteryState (subset) */
export interface BatteryState {
  header: Header;
  voltage: number;
  current: number;
  charge: number;
  capacity: number;
  percentage: number;
  /** Estimated remaining time in seconds at current consumption. */
  remaining_time: number;
  power_supply_status: 'DISCHARGING' | 'FULL' | 'NOT_CHARGING';
  power_supply_health: 'GOOD' | 'DEAD' | 'LOW' | 'CRITICAL';
}

export type MotorError = 'NONE' | 'MOTOR_FAILURE' | 'OVERHEAT' | 'OVERCURRENT';

export interface MotorChannel {
  rpm: number;
  temperature: number;
  current: number;
  voltage: number;
  error: MotorError;
}

/** rover_msgs/MotorState */
export interface MotorStateMsg {
  header: Header;
  leftMotor: MotorChannel;
  rightMotor: MotorChannel;
}

/** geometry_msgs/Twist on /cmd_vel */
export type CmdVel = Twist;

export type MissionState = 'IDLE' | 'RUNNING' | 'PAUSED' | 'COMPLETED' | 'FAILED' | 'ABORTED';

/** rover_msgs/MissionStatus */
export interface MissionStatusMsg {
  header: Header;
  state: MissionState;
  goal: { x: number; y: number } | null;
  goalIndex: number;
  goalCount: number;
  home: { x: number; y: number };
  tolerance: number;
  elapsed: number;
  reason: string;
}

/** Message type names used by the virtual topic graph. */
export const MSG_TYPES = {
  LaserScan: 'sensor_msgs/LaserScan',
  Imu: 'sensor_msgs/Imu',
  Odometry: 'nav_msgs/Odometry',
  NavSatFix: 'sensor_msgs/NavSatFix',
  BatteryState: 'sensor_msgs/BatteryState',
  MotorState: 'rover_msgs/MotorState',
  Twist: 'geometry_msgs/Twist',
  MissionStatus: 'rover_msgs/MissionStatus',
  Decision: 'rover_msgs/Decision',
  SafetyStatus: 'rover_msgs/SafetyStatus',
  RoverState: 'rover_msgs/AggregatedState',
} as const;

/** Canonical topic names. */
export const TOPICS = {
  scan: '/scan',
  imu: '/imu',
  odom: '/odom',
  gps: '/gps',
  battery: '/battery',
  motorState: '/motor_state',
  cmdVel: '/cmd_vel',
  mission: '/mission',
  decision: '/decision',
  safety: '/safety',
  roverState: '/rover_state',
} as const;

export type TopicName = (typeof TOPICS)[keyof typeof TOPICS];
