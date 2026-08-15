"use client";

/**
 * Subscribe to postgres_changes on workspace-scoped tables; fires `onChange` on
 * every INSERT/UPDATE/DELETE. Single implementation behind useKnowledgeRealtime
 * / useSkillsRealtime / useChannelsRealtime.
 *
 * Channels are SHARED: every mount with the same `(topicPrefix, workspaceId,
 * tables)` rides one ref-counted channel (shared-channel-registry.ts). Reconnect
 * backoff and the Supabase v2 "no `.on()` after `.subscribe()`" constraint live
 * inside the registry.
 *
 * RLS still applies — the client connects under the user's auth.
 */

import { useEffect, useRef } from "react";
import { subscribeSharedWorkspaceTables } from "./shared-channel-registry";

export function useWorkspaceTablesRealtime(
  workspaceId: string | null | undefined,
  /** Tables to watch, each filtered by `workspace_id=eq.<id>`. ⚠ Pass a stable
   *  (module-level) array — the list is part of the channel share key. */
  tables: readonly string[],
  /** Channel topic prefix, e.g. "knowledge-realtime". */
  topicPrefix: string,
  onChange: () => void
): void {
  // Latest onChange in a ref: freshest closure, no resubscribe per render.
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });

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
    // ⚠ join() keeps the dep primitive so an accidentally-inline array with
    // identical contents still behaves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, topicPrefix, tables.join(",")]);
}
