import type { RobotTransport, TopicCallback, TopicInfo, TopicMessage } from '@rover/protocol';

export interface Ros2TransportOptions {
  /** e.g. ws://rover.local:9090 for rosbridge_suite. */
  url: string;
  namespace?: string;
}

/**
 * Placeholder for the physical rover bridge.
 *
 * Planned implementation: connect to rosbridge_suite (WebSocket, JSON) or use rclnodejs,
 * translate `subscribe`/`publish` to ROS2 topics with the same names and message types
 * declared in @rover/protocol (sensor_msgs/LaserScan, nav_msgs/Odometry, …).
 * See docs/ros2-bridge.md.
 */
export class Ros2Transport implements RobotTransport {
  readonly kind = 'ros2' as const;

  constructor(readonly options: Ros2TransportOptions) {}

  advertise(): void {
    throw new Error('Ros2Transport is not implemented yet (REAL_ROBOT mode is a placeholder).');
  }

  publish(): void {
    throw new Error('Ros2Transport is not implemented yet (REAL_ROBOT mode is a placeholder).');
  }

  subscribe<T>(_topic: string, _callback: TopicCallback<T>): () => void {
    throw new Error('Ros2Transport is not implemented yet (REAL_ROBOT mode is a placeholder).');
  }

  getTopicInfo(): TopicInfo[] {
    return [];
  }

  getLastMessage<T>(): TopicMessage<T> | undefined {
    return undefined;
  }
}
