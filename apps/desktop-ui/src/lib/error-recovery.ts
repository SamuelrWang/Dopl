import type { QueryClient } from "@tanstack/react-query";
import { getBridge } from "./dopl-bridge";

/** Refetch every mounted query sitting in `error`; a fetch already in flight is left alone. */
export function refetchErroredQueries(client: QueryClient): Promise<void> {
  return client.refetchQueries(
    { type: "active", predicate: (query) => query.state.status === "error" },
    { cancelRefetch: false }
  );
}

/**
 * Errored queries recover without a reload: when main reports a wake/unlock, when the
 * network comes back, and when the window regains focus. Returns the teardown.
 */
export function armErrorRecovery(client: QueryClient, target: Window = window): () => void {
  const kick = () => {
    void refetchErroredQueries(client);
  };
  const offWake = getBridge()?.onWake?.(kick) ?? (() => {});
  target.addEventListener("online", kick);
  target.addEventListener("focus", kick);
  return () => {
    offWake();
    target.removeEventListener("online", kick);
    target.removeEventListener("focus", kick);
  };
}
