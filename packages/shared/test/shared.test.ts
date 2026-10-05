import { describe, expect, it } from 'vitest';
import { Rng, mergeKnown, rayAabb, rayBoundsInterior, rayCircle, wrapAngle, RateMeter } from '../src';

describe('Rng', () => {
  it('is deterministic for the same seed', () => {
    const a = new Rng(12345);
    const b = new Rng(12345);
    for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next());
  });
  it('derives independent streams per name', () => {
    expect(Rng.derive(1, 'lidar').next()).not.toBe(Rng.derive(1, 'imu').next());
    expect(Rng.derive(1, 'lidar').next()).toBe(Rng.derive(1, 'lidar').next());
  });
  it('produces roughly standard normal samples', () => {
    const r = new Rng(7);
    let sum = 0;
    let sq = 0;
    const n = 20000;
    for (let i = 0; i < n; i++) {
      const g = r.gaussian();
      sum += g;
      sq += g * g;
    }
    expect(Math.abs(sum / n)).toBeLessThan(0.05);
    expect(Math.abs(sq / n - 1)).toBeLessThan(0.05);
  });
});

describe('math & geometry', () => {
  it('wraps angles to (-π, π]', () => {
    expect(wrapAngle(3 * Math.PI)).toBeCloseTo(Math.PI);
    expect(wrapAngle(-3 * Math.PI / 2)).toBeCloseTo(Math.PI / 2);
  });
  it('intersects rays with circles and boxes', () => {
    expect(rayCircle(0, 0, 1, 0, 5, 0, 1)).toBeCloseTo(4);
    expect(rayCircle(0, 0, -1, 0, 5, 0, 1)).toBe(Infinity);
    expect(rayAabb(0, 0, 1, 0, 3, -1, 4, 1)).toBeCloseTo(3);
    expect(rayAabb(0, 0, 0, 1, 3, -1, 4, 1)).toBe(Infinity);
    expect(rayBoundsInterior(2, 2, 1, 0, 10, 10)).toBeCloseTo(8);
  });
});

describe('mergeKnown', () => {
  it('merges only known keys with matching types', () => {
    const target = { a: 1, b: { c: 'x', d: true }, headers: { k: 'v' } };
    const changed = mergeKnown(target, { a: 2, b: { c: 5, d: false }, z: 1, headers: { n: 'm' } });
    expect(target).toEqual({ a: 2, b: { c: 'x', d: false }, headers: { n: 'm' } });
    expect(changed).toEqual(['a', 'b.d', 'headers']);
  });
  it('rejects non-finite numbers', () => {
    const t = { a: 1 };
    mergeKnown(t, { a: Number.NaN });
    expect(t.a).toBe(1);
  });
});

describe('RateMeter', () => {
  it('measures a steady rate', () => {
    const m = new RateMeter(2);
    for (let i = 0; i <= 100; i++) m.mark(i * 0.05);
    expect(m.rate(5)).toBeCloseTo(20, 0);
  });
});
