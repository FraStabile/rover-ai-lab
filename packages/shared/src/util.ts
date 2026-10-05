export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Deep merges `patch` into `target` in place, only for keys that already exist in `target`
 * and whose value type matches. Returns the list of changed dotted paths.
 */
export function mergeKnown(target: Record<string, unknown>, patch: unknown, prefix = ''): string[] {
  const changed: string[] = [];
  if (!isPlainObject(patch)) return changed;
  for (const [key, value] of Object.entries(patch)) {
    if (!(key in target)) continue;
    const current = target[key];
    const path = prefix ? `${prefix}.${key}` : key;
    if (isPlainObject(current) && isPlainObject(value)) {
      // Free-form maps (headers, actionMap) are replaced wholesale.
      if (key === 'headers' || key === 'actionMap') {
        if (Object.values(value).every((x) => typeof x === 'string')) {
          target[key] = { ...value };
          changed.push(path);
        }
        continue;
      }
      changed.push(...mergeKnown(current, value, path));
    } else if (typeof current === typeof value && !isPlainObject(value)) {
      if (typeof value === 'number' && !Number.isFinite(value)) continue;
      if (current !== value) {
        target[key] = value;
        changed.push(path);
      }
    }
  }
  return changed;
}

/** Reads a dotted path ("a.b.0.c") from an object. */
export function getPath(obj: unknown, path: string): unknown {
  if (!path) return obj;
  let cur: unknown = obj;
  for (const part of path.split('.')) {
    if (cur === null || cur === undefined) return undefined;
    if (Array.isArray(cur)) cur = cur[Number(part)];
    else if (typeof cur === 'object') cur = (cur as Record<string, unknown>)[part];
    else return undefined;
  }
  return cur;
}

export function deepClone<T>(v: T): T {
  return structuredClone(v);
}

/** Fixed-size ring buffer. */
export class RingBuffer<T> {
  private items: T[] = [];
  constructor(private readonly capacity: number) {}

  push(item: T): void {
    this.items.push(item);
    if (this.items.length > this.capacity) this.items.splice(0, this.items.length - this.capacity);
  }

  toArray(): T[] {
    return this.items.slice();
  }

  last(n: number): T[] {
    return this.items.slice(Math.max(0, this.items.length - n));
  }

  get size(): number {
    return this.items.length;
  }

  clear(): void {
    this.items = [];
  }
}

/** Measures event rate over a sliding window of timestamps (seconds). */
export class RateMeter {
  private stamps: number[] = [];
  constructor(private readonly window = 2) {}

  mark(t: number): void {
    this.stamps.push(t);
    const cutoff = t - this.window;
    let i = 0;
    while (i < this.stamps.length && this.stamps[i] < cutoff) i++;
    if (i > 0) this.stamps.splice(0, i);
  }

  rate(now: number): number {
    const cutoff = now - this.window;
    let first = -1;
    let last = -1;
    let n = 0;
    for (const s of this.stamps) {
      if (s >= cutoff) {
        if (first < 0) first = s;
        last = s;
        n++;
      }
    }
    if (n < 2) return 0;
    // n events span (n-1) periods; adding one mean period makes the estimate unbiased
    // while still decaying when events stop arriving.
    const period = (last - first) / (n - 1);
    const span = now - first + period;
    return span > 1e-9 ? n / span : 0;
  }

  reset(): void {
    this.stamps = [];
  }
}
