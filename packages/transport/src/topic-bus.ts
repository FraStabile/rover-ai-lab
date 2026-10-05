import type { RobotTransport, TopicCallback, TopicInfo, TopicMessage, TopicStatus } from '@rover/protocol';
import { RateMeter } from '@rover/shared';

interface TopicRecord {
  name: string;
  type: string;
  publisher: string;
  expectedHz: number;
  count: number;
  seq: number;
  meter: RateMeter;
  last?: TopicMessage;
  subscribers: Set<TopicCallback>;
}

export interface Clock {
  /** Current sim time (s). */
  now(): number;
}

/**
 * In-process publish/subscribe bus that behaves like a ROS2 topic graph:
 * typed topics, publishers, per-topic stats and last-message caching.
 * Delivery is synchronous, which keeps the simulation deterministic.
 */
export class InMemoryTopicBus implements RobotTransport {
  readonly kind: 'simulation' | 'ros2' = 'simulation';
  private topics = new Map<string, TopicRecord>();
  private wildcard = new Set<TopicCallback>();
  private onError: (topic: string, err: unknown) => void = () => {};

  constructor(private readonly clock: Clock) {}

  setErrorHandler(handler: (topic: string, err: unknown) => void): void {
    this.onError = handler;
  }

  advertise(topic: string, type: string, publisher: string, expectedHz = 0): void {
    const rec = this.ensure(topic);
    rec.type = type;
    rec.publisher = publisher;
    rec.expectedHz = expectedHz;
  }

  publish<T>(topic: string, data: T, publisher?: string): void {
    const rec = this.ensure(topic);
    if (publisher) rec.publisher = publisher;
    const simTime = this.clock.now();
    rec.count++;
    rec.seq++;
    rec.meter.mark(simTime);
    const msg: TopicMessage<T> = {
      topic,
      type: rec.type,
      publisher: rec.publisher,
      simTime,
      wallTime: Date.now(),
      seq: rec.seq,
      data,
    };
    rec.last = msg;
    for (const cb of rec.subscribers) this.deliver(cb, msg);
    for (const cb of this.wildcard) this.deliver(cb, msg);
  }

  subscribe<T>(topic: string, callback: TopicCallback<T>): () => void {
    const cb = callback as TopicCallback;
    if (topic === '*') {
      this.wildcard.add(cb);
      return () => this.wildcard.delete(cb);
    }
    const rec = this.ensure(topic);
    rec.subscribers.add(cb);
    return () => rec.subscribers.delete(cb);
  }

  getLastMessage<T>(topic: string): TopicMessage<T> | undefined {
    return this.topics.get(topic)?.last as TopicMessage<T> | undefined;
  }

  getTopicInfo(): TopicInfo[] {
    const now = this.clock.now();
    return [...this.topics.values()]
      .map((r) => {
        const age = r.last ? now - r.last.simTime : Infinity;
        const expectedPeriod = r.expectedHz > 0 ? 1 / r.expectedHz : 2;
        let status: TopicStatus = 'IDLE';
        if (r.last) status = age <= Math.max(expectedPeriod * 3, 0.25) ? 'ACTIVE' : 'STALE';
        if (r.expectedHz === 0 && r.last) status = 'ACTIVE';
        return {
          name: r.name,
          type: r.type,
          publisher: r.publisher,
          expectedHz: r.expectedHz,
          frequency: r.meter.rate(now),
          messageCount: r.count,
          lastSimTime: r.last?.simTime ?? null,
          lastWallTime: r.last?.wallTime ?? null,
          status,
          subscribers: r.subscribers.size,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Clears counters and cached messages (keeps subscriptions). */
  resetStats(): void {
    for (const r of this.topics.values()) {
      r.count = 0;
      r.seq = 0;
      r.meter.reset();
      r.last = undefined;
    }
  }

  private ensure(topic: string): TopicRecord {
    let rec = this.topics.get(topic);
    if (!rec) {
      rec = {
        name: topic,
        type: 'unknown',
        publisher: 'unknown',
        expectedHz: 0,
        count: 0,
        seq: 0,
        meter: new RateMeter(2),
        subscribers: new Set(),
      };
      this.topics.set(topic, rec);
    }
    return rec;
  }

  private deliver(cb: TopicCallback, msg: TopicMessage): void {
    try {
      cb(msg);
    } catch (err) {
      this.onError(msg.topic, err);
    }
  }
}

/** The transport used by the simulator. Same semantics as a ROS2 graph, in-process. */
export class SimulationTransport extends InMemoryTopicBus {}
