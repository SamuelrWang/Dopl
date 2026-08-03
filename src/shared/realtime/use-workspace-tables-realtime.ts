"use client";

/**
 * useWorkspaceTablesRealtime — subscribe to Supabase Realtime
 * postgres_changes on a set of workspace-scoped tables. Fires `onChange`
 * on every INSERT/UPDATE/DELETE so the caller can refetch.
 *
 * Single implementation behind useKnowledgeRealtime / useSkillsRealtime /
 * useChannelsRealtime etc. Since Phase 0 of the desktop migration
 * (docs/DESKTOP-MIGRATION-PLAN.md) the underlying channels are SHARED:
 * every mount with the same `(topicPrefix, workspaceId, tables)` rides one
 * ref-counted channel (see shared-channel-registry.ts) instead of opening
 * its own — same events, same catch-up-refetch-on-subscribe semantics, a
 * fraction of the server-side subscription count. Reconnect backoff and
 * the Supabase v2 "no `.on()` after `.subscribe()`" constraint are handled
 * inside the registry.
 *
 * RLS still applies — the client connects under the user's auth, so the
 * server filters events to rows the user can read.
 */

import { useEffect, useRef } from "react";
import { subscribeSharedWorkspaceTables } from "./shared-channel-registry";

export function useWorkspaceTablesRealtime(
  workspaceId: string | null | undefined,
  /** Table names to watch; each is filtered by `workspace_id=eq.<id>`.
   *  Pass a stable (module-level) array — the list is part of the channel
   *  share key. */
  tables: readonly string[],
  /** Channel topic prefix, e.g. "knowledge-realtime". */
  topicPrefix: string,
  onChange: () => void
): void {
  // Latest onChange in a ref so the subscription captures the freshest
  // closure without resubscribing on every render.
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });

  // Stable ref to the tables list for the effect body; the join() dep
  // below is what actually decides when to resubscribe, so an
  // accidentally-inline array with identical contents still behaves.
  const tablesRef = useRef(tables);
  tablesRef.current = tables;

  useEffect(() => {
    if (!workspaceId) return;
    return subscribeSharedWorkspaceTables(
      workspaceId,
      tablesRef.current,
      topicPrefix,
      () => onChangeRef.current()
    );
    // `tables` is expected to be a module-level constant; joining keeps the
    // dep primitive so an accidentally-inline array still behaves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, topicPrefix, tables.join(",")]);
}
