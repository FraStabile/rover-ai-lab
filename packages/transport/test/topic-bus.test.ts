import { describe, expect, it } from 'vitest';
import { SimulationTransport } from '../src';

describe('SimulationTransport', () => {
  it('delivers messages and tracks topic stats', () => {
    let t = 0;
    const bus = new SimulationTransport({ now: () => t });
    bus.advertise('/scan', 'sensor_msgs/LaserScan', '/lidar', 20);
    const got: number[] = [];
    const unsub = bus.subscribe<{ v: number }>('/scan', (m) => got.push(m.data.v));
    for (let i = 0; i < 40; i++) {
      t = i * 0.05;
      bus.publish('/scan', { v: i });
    }
    expect(got).toHaveLength(40);
    const info = bus.getTopicInfo().find((x) => x.name === '/scan')!;
    expect(info.type).toBe('sensor_msgs/LaserScan');
    expect(info.publisher).toBe('/lidar');
    expect(info.messageCount).toBe(40);
    expect(info.frequency).toBeGreaterThan(18);
    expect(info.status).toBe('ACTIVE');
    expect(bus.getLastMessage<{ v: number }>('/scan')?.data.v).toBe(39);
    unsub();
    bus.publish('/scan', { v: 99 });
    expect(got).toHaveLength(40);
    t = 10;
    expect(bus.getTopicInfo()[0].status).toBe('STALE');
  });

  it('isolates subscriber errors', () => {
    const bus = new SimulationTransport({ now: () => 0 });
    const errors: string[] = [];
    bus.setErrorHandler((topic) => errors.push(topic));
    let ok = 0;
    bus.subscribe('/x', () => {
      throw new Error('boom');
    });
    bus.subscribe('/x', () => ok++);
    bus.publish('/x', 1);
    expect(ok).toBe(1);
    expect(errors).toEqual(['/x']);
  });
});
