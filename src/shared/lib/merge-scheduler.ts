/**
 * A debounced, per-key MERGING save scheduler.
 *
 * Multiple `schedule()` calls for the same key inside the delay window merge
 * their (shallow) payload objects and collapse to a single run of the newest
 * runner with the FULL merged payload — so editing two fields of one entity
 * in quick succession never drops the first field's write (the bug a
 * per-entity, per-field-payload debounce had). Framework-agnostic and
 * synchronously testable with fake timers.
 *
 * Beyond debouncing it exposes `cancel`/`flush` (and their `*Where`
 * predicate variants) so a caller can, before a structural mutation, either
 * force pending text saves out (avoiding an invalidation clobbering them) or
 * drop saves for an entity that's being deleted (avoiding a late timer
 * resurrecting it).
 */

interface Entry {
  payload: Record<string, unknown>;
  run: (merged: Record<string, unknown>) => Promise<void>;
  timer: ReturnType<typeof setTimeout>;
}

export interface MergeScheduler {
  /** Merge `patch` into the key's pending payload and (re)arm its timer. */
  schedule<P extends object>(
    key: string,
    patch: P,
    run: (merged: P) => Promise<void>
  ): void;
  /** Drop the key's pending save without running it. */
  cancel(key: string): void;
  /** Drop every pending save whose key matches `pred`, without running. */
  cancelWhere(pred: (key: string) => boolean): void;
  /** Run the key's pending save now (awaitable); no-op if none pending. */
  flush(key: string): Promise<void>;
  /** Run every pending save whose key matches `pred` now (awaitable). */
  flushWhere(pred: (key: string) => boolean): Promise<void>;
  /** Run every pending save now (awaitable) — used on unmount. */
  flushAll(): Promise<void>;
  /** Keys with a pending (unflushed) save. */
  pendingKeys(): string[];
}

export function createMergeScheduler(delayMs: number): MergeScheduler {
  const entries = new Map<string, Entry>();

  function fire(key: string): Promise<void> {
    const entry = entries.get(key);
    if (!entry) return Promise.resolve();
    clearTimeout(entry.timer);
    entries.delete(key);
    return entry.run(entry.payload);
  }

  function cancel(key: string): void {
    const entry = entries.get(key);
    if (!entry) return;
    clearTimeout(entry.timer);
    entries.delete(key);
  }

  return {
    schedule<P extends object>(
      key: string,
      patch: P,
      run: (merged: P) => Promise<void>
    ): void {
      const existing = entries.get(key);
      if (existing) clearTimeout(existing.timer);
      const payload = { ...(existing?.payload ?? {}), ...patch };
      const timer = setTimeout(() => void fire(key), delayMs);
      entries.set(key, {
        payload,
        run: run as (merged: Record<string, unknown>) => Promise<void>,
        timer,
      });
    },
    cancel,
    cancelWhere(pred: (key: string) => boolean): void {
      for (const key of [...entries.keys()]) if (pred(key)) cancel(key);
    },
    flush(key: string): Promise<void> {
      return fire(key);
    },
    flushWhere(pred: (key: string) => boolean): Promise<void> {
      return Promise.all(
        [...entries.keys()].filter(pred).map((k) => fire(k))
      ).then(() => undefined);
    },
    flushAll(): Promise<void> {
      return Promise.all([...entries.keys()].map((k) => fire(k))).then(
        () => undefined
      );
    },
    pendingKeys(): string[] {
      return [...entries.keys()];
    },
  };
}
