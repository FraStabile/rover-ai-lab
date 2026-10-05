import type { AppConfig, ControlMode, DevMode } from './config';
import type { AggregatedState, AiExchange, AiLinkStatus, Decision, ModelInfo, SafetyVerdict } from './decision';
import type { LogEvent } from './log';
import type { MissionState, MotorChannel } from './messages';
import type { Scenario } from './scenario';
import type { TopicInfo, TopicMessage } from './transport';

export type SimStatus = 'RUNNING' | 'PAUSED' | 'STOPPED' | 'UNAVAILABLE';

/** Compact snapshot of the simulation, sent to the UI (~20Hz) and recorded for replay (~10Hz). */
export interface SimFrame {
  tick: number;
  simTime: number;
  wallTime: number;
  status: SimStatus;
  mode: ControlMode;
  devMode: DevMode;
  /** Ground truth pose (rad). */
  pose: { x: number; y: number; heading: number };
  /** Pose estimated by odometry (rad). */
  odomPose: { x: number; y: number; heading: number };
  velocity: { linear: number; angular: number };
  acceleration: number;
  battery: { percentage: number; voltage: number; current: number; remainingTime: number; health: string };
  motors: { left: MotorChannel; right: MotorChannel };
  cmdVel: { linear: number; angular: number };
  decision: Decision | null;
  safety: SafetyVerdict | null;
  mission: {
    state: MissionState;
    goal: { x: number; y: number } | null;
    goalIndex: number;
    goalCount: number;
    distance: number | null;
    bearing: number | null;
    eta: number | null;
    elapsed: number;
  };
  lidar: { angleMin: number; angleIncrement: number; rangeMax: number; ranges: number[] } | null;
  gps: { fix: boolean; latitude: number; longitude: number } | null;
  collision: boolean;
  collisions: number;
  estop: boolean;
  ai: { status: AiLinkStatus; provider: string; latencyMs: number | null; inFlight: boolean };
}

export interface DebugStats {
  simTickRate: number;
  sensorTickRates: Record<string, number>;
  aiTickRate: number;
  wsMessageRate: number;
  wsClients: number;
  simTime: number;
  ticks: number;
  realtimeFactor: number;
  stepDurationMs: number;
  cpuPercent: number | null;
  memoryMb: number | null;
  loopLagMs: number;
}

export interface AiInspectorData {
  provider: string;
  model: ModelInfo | null;
  status: AiLinkStatus;
  lastExchange: AiExchange | null;
  history: Array<Pick<AiExchange, 'id' | 'simTime' | 'decision' | 'latencyMs' | 'error'>>;
  decisionsPerSecond: number;
  avgLatencyMs: number | null;
}

export interface ServerHello {
  config: AppConfig;
  scenario: Scenario;
  mode: ControlMode;
  devMode: DevMode;
  status: SimStatus;
  recording: { active: boolean; frames: number; duration: number };
  version: string;
}

export type ServerMessage =
  | { type: 'hello'; data: ServerHello }
  | { type: 'frame'; data: SimFrame }
  | { type: 'logs'; data: LogEvent[] }
  | { type: 'topics'; data: TopicInfo[] }
  | { type: 'topic_messages'; topic: string; data: TopicMessage[] }
  | { type: 'state'; data: AggregatedState | null }
  | { type: 'ai'; data: AiInspectorData }
  | { type: 'config'; data: AppConfig }
  | { type: 'scenario'; data: Scenario }
  | { type: 'status'; data: { status: SimStatus; mode: ControlMode; devMode: DevMode; recording: ServerHello['recording'] } }
  | { type: 'debug'; data: DebugStats }
  | { type: 'error'; message: string };

export type ClientMessage =
  | { type: 'manual'; throttle: number; steering: number }
  | { type: 'subscribe_topic'; topic: string | null }
  | { type: 'ping'; t: number };
