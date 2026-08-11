/**
 * A per-key FIFO serializer for immediate async operations.
 *
 * Every `run(key, op)` chains its `op` behind the previous op registered
 * under the same key, so two ops on one key never run concurrently and the
 * second op's work begins only AFTER the first has settled — even when both
 * `run` calls are made synchronously (the case a bare promise race loses).
 * Distinct keys are independent: they neither order nor block one another.
 *
 * Used to order rapid connect/disconnect on the SAME graph edge: the
 * DELETE can no longer overtake the POST by racing on network timing,
 * because it only issues once the POST's op has settled.
 *
 * Framework-agnostic and synchronously testable. Unlike `merge-scheduler`
 * (debounce + merge) and `persist-gate` (a global in-flight counter, not
 * per-key), this is immediate and strictly FIFO per key.
 */
export interface KeyedSerializer {
  /** Run `op` after the key's prior op settles; resolves with its result. */
  run<T>(key: string, op: () => Promise<T>): Promise<T>;
}

export function createKeyedSerializer(): KeyedSerializer {
  const tails = new Map<string, Promise<unknown>>();

  return {
    run<T>(key: string, op: () => Promise<T>): Promise<T> {
      const prev = tails.get(key) ?? Promise.resolve();
      // Chain regardless of the prior op's outcome — a rejected op must not
      // block the ops queued behind it.
      const result = prev.then(op, op);
      // Store a rejection-swallowing tail so a failing op neither poisons the
      // chain nor surfaces as an unhandled rejection; callers awaiting
      // `result` still observe the real outcome.
      const tail = result.then(
        () => undefined,
        () => undefined
      );
      tails.set(key, tail);
      // Drop the key once its chain drains so the map can't grow unbounded
      // over a long session — but only if nothing newer took the slot.
      void tail.then(() => {
        if (tails.get(key) === tail) tails.delete(key);
      });
      return result;
    },
  };
}
