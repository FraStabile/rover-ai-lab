export const fmt = (v: number | null | undefined, digits = 2, unit = ''): string =>
  v === null || v === undefined || !Number.isFinite(v) ? '—' : `${v.toFixed(digits)}${unit}`;

export const deg = (rad: number): number => (rad * 180) / Math.PI;

export function fmtDuration(s: number | null | undefined): string {
  if (s === null || s === undefined || !Number.isFinite(s) || s < 0) return '—';
  if (s > 3600) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  if (s > 60) return `${Math.floor(s / 60)}m ${Math.floor(s % 60)}s`;
  return `${s.toFixed(1)}s`;
}

export function ago(wall: number | null): string {
  if (wall === null) return '—';
  const d = Date.now() - wall;
  if (d < 1000) return `${Math.max(0, d)}ms ago`;
  if (d < 60_000) return `${(d / 1000).toFixed(1)}s ago`;
  return `${Math.floor(d / 60_000)}m ago`;
}

/** JSON.stringify that shortens long numeric arrays (e.g. LaserScan ranges). */
export function prettyJson(v: unknown, maxArray = 24): string {
  return JSON.stringify(
    v,
    (_k, val) => {
      if (Array.isArray(val) && val.length > maxArray && val.every((x) => typeof x === 'number')) {
        return `[${val.slice(0, maxArray).map((x: number) => +x.toFixed(3)).join(', ')}, … +${val.length - maxArray} more]`;
      }
      if (typeof val === 'number' && !Number.isInteger(val)) return +val.toFixed(4);
      return val;
    },
    2,
  );
}

/** Flattens numeric leaves of an object into dotted paths (for topic plots). */
export function numericPaths(v: unknown, prefix = '', out: string[] = [], depth = 0): string[] {
  if (depth > 5 || v === null || typeof v !== 'object') return out;
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
    const p = prefix ? `${prefix}.${k}` : k;
    if (typeof x === 'number') out.push(p);
    else if (x && typeof x === 'object' && !Array.isArray(x)) numericPaths(x, p, out, depth + 1);
  }
  return out;
}

export function getPath(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const part of path.split('.')) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

/** Y-axis domain that never collapses to a single value (Recharts would emit duplicate ticks). */
export function paddedDomain(data: object[], keys: string[]): [number, number] {
  let min = Infinity;
  let max = -Infinity;
  for (const d of data) {
    for (const k of keys) {
      const v = (d as Record<string, unknown>)[k];
      if (typeof v === 'number' && Number.isFinite(v)) {
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }
  }
  if (!Number.isFinite(min)) return [0, 1];
  const span = max - min;
  const pad = span < 1e-6 ? Math.max(Math.abs(max) * 0.05, 0.5) : span * 0.08;
  return [min - pad, max + pad];
}
