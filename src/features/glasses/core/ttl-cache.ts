/**
 * A per-process map with a TTL and a hard size cap. Oldest-inserted entries are
 * evicted first when full, so memory stays bounded however many users or
 * devices a process sees.
 */
export class TtlCache<K, V> {
  private readonly entries = new Map<K, { value: V; at: number }>();

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries: number,
  ) {}

  get(key: K, now: number): V | undefined {
    const hit = this.entries.get(key);
    if (!hit) return undefined;
    if (now - hit.at >= this.ttlMs) {
      this.entries.delete(key);
      return undefined;
    }
    return hit.value;
  }

  set(key: K, value: V, now: number): void {
    this.entries.delete(key);
    if (this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next();
      if (!oldest.done) this.entries.delete(oldest.value);
    }
    this.entries.set(key, { value, at: now });
  }
}

/** Lets an action through at most once per `intervalMs` per key (bounded like {@link TtlCache}). */
export class Throttle<K> {
  private readonly last: TtlCache<K, true>;

  constructor(intervalMs: number, maxKeys: number) {
    this.last = new TtlCache<K, true>(intervalMs, maxKeys);
  }

  /** True when the action may run now (and arms the interval). */
  tryAcquire(key: K, now: number): boolean {
    if (this.last.get(key, now)) return false;
    this.last.set(key, true, now);
    return true;
  }
}
