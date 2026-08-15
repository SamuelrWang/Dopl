/**
 * Per-key FIFO serializer for immediate async operations. `run(key, op)` chains
 * behind the previous op for that key, so the second op's work begins only AFTER
 * the first settles — ⚠ including when both `run` calls are synchronous, the
 * case a bare promise race loses. Distinct keys neither order nor block.
 *
 * Orders rapid connect/disconnect on the SAME graph edge: the DELETE cannot
 * overtake the POST by racing on network timing.
 *
 * Contrast `merge-scheduler` (debounce + merge) and `persist-gate` (a GLOBAL
 * in-flight counter, not per-key).
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
      // ⚠ Chain regardless of the prior op's outcome — a rejected op must not
      // block the ops queued behind it.
      const result = prev.then(op, op);
      // ⚠ Rejection-swallowing tail: a failing op neither poisons the chain nor
      // surfaces as an unhandled rejection. Callers awaiting `result` still see
      // the real outcome.
      const tail = result.then(
        () => undefined,
        () => undefined
      );
      tails.set(key, tail);
      // Drop the key once its chain drains (unbounded map otherwise) — ⚠ only
      // if nothing newer took the slot.
      void tail.then(() => {
        if (tails.get(key) === tail) tails.delete(key);
      });
      return result;
    },
  };
}
