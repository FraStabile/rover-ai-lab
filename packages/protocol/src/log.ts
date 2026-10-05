export type LogCategory = 'SENSOR' | 'AI' | 'ROS2' | 'SAFETY' | 'MOTOR' | 'MISSION' | 'SYSTEM' | 'ERROR';
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type LogEventType =
  | 'SENSOR_UPDATE'
  | 'SENSOR_FAILURE'
  | 'STATE_GENERATED'
  | 'AI_REQUEST'
  | 'AI_RESPONSE'
  | 'AI_TIMEOUT'
  | 'AI_ERROR'
  | 'DECISION'
  | 'SAFETY_ALLOW'
  | 'SAFETY_OVERRIDE'
  | 'SAFETY_BLOCK'
  | 'MOTOR_COMMAND'
  | 'MOTOR_FAULT'
  | 'COLLISION'
  | 'BATTERY_WARNING'
  | 'BATTERY_CRITICAL'
  | 'TARGET_REACHED'
  | 'WAYPOINT_REACHED'
  | 'MISSION_STATE'
  | 'TOPIC_ADVERTISED'
  | 'TOPIC_STALE'
  | 'SIM_CONTROL'
  | 'CONFIG_CHANGED'
  | 'SCENARIO_LOADED'
  | 'FAILURE_INJECTED'
  | 'MODE_CHANGED'
  | 'SYSTEM_ERROR'
  | 'INFO';

export interface LogEvent {
  id: number;
  /** Wall clock ms. */
  timestamp: number;
  /** Sim seconds. */
  simulationTime: number;
  type: LogEventType;
  category: LogCategory;
  level: LogLevel;
  source: string;
  message: string;
  payload?: unknown;
}
