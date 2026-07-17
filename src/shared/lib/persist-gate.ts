/**
 * Tracks in-flight async persists so a caller can tell whether a write is
 * still landing. Needed because the merge-scheduler deletes a pending key
 * BEFORE awaiting its runner, so `pendingKeys()` reads empty during the
 * actual network PATCH — leaving an "adopt when idle" guard blind to a write
 * still in flight (it could revert a just-dragged card mid-PATCH).
 *
 * `busy()` stays true from the moment a run starts until its promise settles;
 * `idle()` resolves once every in-flight run has settled — used to serialize
 * a reset write strictly AFTER any drag write already in flight (so the
 * empty-`{}` reset can't be overtaken by a late drag PATCH). Framework-
 * agnostic and synchronously testable.
 */
export interface PersistGate {
  /** Run `fn`, counting it as in-flight until its promise settles. */
  run(fn: () => Promise<void>): Promise<void>;
  /** True while any run is in flight. */
  busy(): boolean;
  /** Resolves once all in-flight runs have settled (immediately if none). */
  idle(): Promise<void>;
}

export function createPersistGate(): PersistGate {
  let inFlight = 0;
  let waiters: Array<() => void> = [];

  function settleOne(): void {
    inFlight = Math.max(0, inFlight - 1);
    if (inFlight === 0 && waiters.length > 0) {
      const pending = waiters;
      waiters = [];
      for (const resolve of pending) resolve();
    }
  }

  return {
    run(fn: () => Promise<void>): Promise<void> {
      inFlight += 1;
      let result: Promise<void>;
      try {
        result = fn();
      } catch (err) {
        settleOne();
        return Promise.reject(err);
      }
      return Promise.resolve(result).finally(settleOne);
    },
    busy(): boolean {
      return inFlight > 0;
    },
    idle(): Promise<void> {
      if (inFlight === 0) return Promise.resolve();
      return new Promise<void>((resolve) => waiters.push(resolve));
    },
  };
}
