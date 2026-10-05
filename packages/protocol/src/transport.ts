export type TopicStatus = 'ACTIVE' | 'STALE' | 'IDLE';

export interface TopicInfo {
  name: string;
  type: string;
  publisher: string;
  /** Expected publication rate (Hz), 0 if event-driven. */
  expectedHz: number;
  /** Measured rate (Hz, over sim time). */
  frequency: number;
  messageCount: number;
  /** Sim time of last message (s). */
  lastSimTime: number | null;
  /** Wall-clock ms of last message. */
  lastWallTime: number | null;
  status: TopicStatus;
  subscribers: number;
}

export interface TopicMessage<T = unknown> {
  topic: string;
  type: string;
  publisher: string;
  simTime: number;
  wallTime: number;
  seq: number;
  data: T;
}

export type TopicCallback<T = unknown> = (msg: TopicMessage<T>) => void;

/**
 * Transport abstraction between the autonomy stack and "the robot".
 * SimulationTransport implements it in-process; a ROS2Transport (rosbridge / rclnodejs)
 * can implement it for the physical rover without touching the decision layer.
 */
export interface RobotTransport {
  readonly kind: 'simulation' | 'ros2';
  advertise(topic: string, type: string, publisher: string, expectedHz?: number): void;
  publish<T>(topic: string, data: T, publisher?: string): void;
  subscribe<T>(topic: string, callback: TopicCallback<T>): () => void;
  getTopicInfo(): TopicInfo[];
  getLastMessage<T>(topic: string): TopicMessage<T> | undefined;
}

/**
 * A SensorProvider fills the transport with sensor topics.
 * SimulationSensorProvider generates them from the simulated world; a ROS2SensorProvider
 * would just bridge real topics into the same transport.
 */
export interface SensorProvider {
  readonly name: string;
  /** Called every simulation tick with the current sim time (s). */
  update(simTime: number): void;
  reset(): void;
}
