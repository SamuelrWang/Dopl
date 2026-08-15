/**
 * Coalescing deferred-refetch coordinator. `request(busy)` runs immediately when
 * idle, else defers and coalesces (many signals → one pending run);
 * `settle(busy)` runs the single coalesced refetch once writes have drained.
 *
 * ⚠ The guard that stops a remote event mid-edit from clobbering an unsent
 * optimistic change (a debounced PATCH, a merge-scheduler entry).
 */
export interface RefetchCoordinator {
  /** A remote change arrived. Run now if idle, else defer + coalesce. */
  request(busy: boolean): void;
  /** A local write settled. Run the deferred refetch iff one is pending
   *  and writes have drained. */
  settle(busy: boolean): void;
  /** Whether a refetch is currently deferred (test/inspection helper). */
  isDeferred(): boolean;
}

export function createRefetchCoordinator(run: () => void): RefetchCoordinator {
  let deferred = false;

  return {
    request(busy: boolean): void {
      if (busy) {
        deferred = true;
        return;
      }
      deferred = false;
      run();
    },
    settle(busy: boolean): void {
      if (deferred && !busy) {
        deferred = false;
        run();
      }
    },
    isDeferred(): boolean {
      return deferred;
    },
  };
}
