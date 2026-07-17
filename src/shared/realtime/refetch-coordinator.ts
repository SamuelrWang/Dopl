/**
 * A coalescing deferred-refetch coordinator.
 *
 * A realtime change fires `request(busy)`: when the feature has local
 * edits in flight (`busy`), the refetch is deferred and coalesced (many
 * signals collapse to one pending run); when idle it runs immediately.
 * When a write settles the feature calls `settle(busy)`, which runs the
 * single coalesced refetch once writes have drained.
 *
 * This is the guard that stops a remote event mid-edit from clobbering an
 * unsent optimistic change (a debounced ontology PATCH, a workflow
 * merge-scheduler entry). Framework-agnostic and synchronously testable.
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
      // Running now satisfies any earlier deferral, so clear the flag.
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
