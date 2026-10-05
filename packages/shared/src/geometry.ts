import type { Obstacle } from '@rover/protocol';

/** Distance along a unit ray to a circle, or Infinity. */
export function rayCircle(ox: number, oy: number, dx: number, dy: number, cx: number, cy: number, r: number): number {
  const fx = ox - cx;
  const fy = oy - cy;
  const b = fx * dx + fy * dy;
  const c = fx * fx + fy * fy - r * r;
  const disc = b * b - c;
  if (disc < 0) return Infinity;
  const s = Math.sqrt(disc);
  const t1 = -b - s;
  if (t1 >= 0) return t1;
  const t2 = -b + s;
  // Origin inside the circle: report contact.
  return t2 >= 0 ? 0 : Infinity;
}

/** Distance along a unit ray to an axis-aligned box (slab method), or Infinity. */
export function rayAabb(
  ox: number,
  oy: number,
  dx: number,
  dy: number,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): number {
  let tmin = -Infinity;
  let tmax = Infinity;
  if (Math.abs(dx) < 1e-12) {
    if (ox < minX || ox > maxX) return Infinity;
  } else {
    const t1 = (minX - ox) / dx;
    const t2 = (maxX - ox) / dx;
    tmin = Math.max(tmin, Math.min(t1, t2));
    tmax = Math.min(tmax, Math.max(t1, t2));
  }
  if (Math.abs(dy) < 1e-12) {
    if (oy < minY || oy > maxY) return Infinity;
  } else {
    const t1 = (minY - oy) / dy;
    const t2 = (maxY - oy) / dy;
    tmin = Math.max(tmin, Math.min(t1, t2));
    tmax = Math.min(tmax, Math.max(t1, t2));
  }
  if (tmax < 0 || tmin > tmax) return Infinity;
  return tmin >= 0 ? tmin : 0;
}

/** Distance along a ray (origin inside the box) to the inner walls of [0,w]×[0,h]. */
export function rayBoundsInterior(ox: number, oy: number, dx: number, dy: number, w: number, h: number): number {
  let t = Infinity;
  if (dx > 1e-12) t = Math.min(t, (w - ox) / dx);
  else if (dx < -1e-12) t = Math.min(t, -ox / dx);
  if (dy > 1e-12) t = Math.min(t, (h - oy) / dy);
  else if (dy < -1e-12) t = Math.min(t, -oy / dy);
  return Math.max(0, t);
}

export function rayObstacle(ox: number, oy: number, dx: number, dy: number, o: Obstacle): number {
  if (o.kind === 'circle') return rayCircle(ox, oy, dx, dy, o.x, o.y, o.r);
  return rayAabb(ox, oy, dx, dy, o.x - o.w / 2, o.y - o.h / 2, o.x + o.w / 2, o.y + o.h / 2);
}

export function circleOverlapsObstacle(cx: number, cy: number, r: number, o: Obstacle): boolean {
  if (o.kind === 'circle') return Math.hypot(cx - o.x, cy - o.y) < r + o.r;
  const nx = Math.max(o.x - o.w / 2, Math.min(cx, o.x + o.w / 2));
  const ny = Math.max(o.y - o.h / 2, Math.min(cy, o.y + o.h / 2));
  return Math.hypot(cx - nx, cy - ny) < r;
}

/** Shortest distance from a point to the boundary of an obstacle (0 if inside). */
export function pointObstacleDistance(px: number, py: number, o: Obstacle): number {
  if (o.kind === 'circle') return Math.max(0, Math.hypot(px - o.x, py - o.y) - o.r);
  const dx = Math.max(o.x - o.w / 2 - px, 0, px - (o.x + o.w / 2));
  const dy = Math.max(o.y - o.h / 2 - py, 0, py - (o.y + o.h / 2));
  return Math.hypot(dx, dy);
}
