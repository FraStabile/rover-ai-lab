import type { LogCategory, LogEvent, LogEventType, LogLevel } from '@rover/protocol';

const CATEGORY_BY_TYPE: Record<LogEventType, LogCategory> = {
  SENSOR_UPDATE: 'SENSOR',
  SENSOR_FAILURE: 'SENSOR',
  STATE_GENERATED: 'AI',
  AI_REQUEST: 'AI',
  AI_RESPONSE: 'AI',
  AI_TIMEOUT: 'AI',
  AI_ERROR: 'AI',
  DECISION: 'AI',
  SAFETY_ALLOW: 'SAFETY',
  SAFETY_OVERRIDE: 'SAFETY',
  SAFETY_BLOCK: 'SAFETY',
  MOTOR_COMMAND: 'MOTOR',
  MOTOR_FAULT: 'MOTOR',
  COLLISION: 'SAFETY',
  BATTERY_WARNING: 'SYSTEM',
  BATTERY_CRITICAL: 'SYSTEM',
  TARGET_REACHED: 'MISSION',
  WAYPOINT_REACHED: 'MISSION',
  MISSION_STATE: 'MISSION',
  TOPIC_ADVERTISED: 'ROS2',
  TOPIC_STALE: 'ROS2',
  SIM_CONTROL: 'SYSTEM',
  CONFIG_CHANGED: 'SYSTEM',
  SCENARIO_LOADED: 'SYSTEM',
  FAILURE_INJECTED: 'SYSTEM',
  MODE_CHANGED: 'SYSTEM',
  SYSTEM_ERROR: 'ERROR',
  INFO: 'SYSTEM',
};

export interface LogInput {
  type: LogEventType;
  source: string;
  message: string;
  payload?: unknown;
  level?: LogLevel;
  category?: LogCategory;
}

export type LogListener = (event: LogEvent) => void;

/**
 * Structured event logger with a bounded in-memory history.
 * Listeners (WebSocket broadcaster, run recorder) receive every event synchronously.
 */
export class EventLogger {
  private nextId = 1;
  private history: LogEvent[] = [];
  private listeners = new Set<LogListener>();

  constructor(
    private readonly simClock: () => number,
    private readonly capacity = 5000,
  ) {}

  log(input: LogInput): LogEvent {
    const level = input.level ?? (input.type === 'SYSTEM_ERROR' ? 'error' : 'info');
    const category = input.category ?? (level === 'error' ? 'ERROR' : CATEGORY_BY_TYPE[input.type]);
    const event: LogEvent = {
      id: this.nextId++,
      timestamp: Date.now(),
      simulationTime: this.simClock(),
      type: input.type,
      category,
      level,
      source: input.source,
      message: input.message,
      payload: input.payload,
    };
    this.history.push(event);
    if (this.history.length > this.capacity) this.history.splice(0, this.history.length - this.capacity);
    for (const l of this.listeners) {
      try {
        l(event);
      } catch {
        // A faulty listener must never break the simulation.
      }
    }
    return event;
  }

  info(type: LogEventType, source: string, message: string, payload?: unknown): LogEvent {
    return this.log({ type, source, message, payload });
  }

  warn(type: LogEventType, source: string, message: string, payload?: unknown): LogEvent {
    return this.log({ type, source, message, payload, level: 'warn' });
  }

  error(source: string, message: string, payload?: unknown): LogEvent {
    return this.log({ type: 'SYSTEM_ERROR', source, message, payload, level: 'error' });
  }

  debug(type: LogEventType, source: string, message: string, payload?: unknown): LogEvent {
    return this.log({ type, source, message, payload, level: 'debug' });
  }

  subscribe(listener: LogListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  recent(limit = 500, category?: LogCategory): LogEvent[] {
    const src = category ? this.history.filter((e) => e.category === category) : this.history;
    return src.slice(Math.max(0, src.length - limit));
  }

  clear(): void {
    this.history = [];
  }
}

export function formatLogLine(e: LogEvent): string {
  return `[${e.simulationTime.toFixed(3)}s] ${e.category.padEnd(7)} ${e.source}: ${e.message}`;
}
