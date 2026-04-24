"use client";

/**
 * use-entries-realtime.ts — subscribe to Supabase realtime on the
 * `entries` table so amber pending tiles on the canvas flip to the
 * ingesting state the instant the user's connected MCP agent claims
 * the row via `prepare_ingest`.
 *
 * Scope: filtered to rows ingested by the current authed user, so we
 * only get notified about the user's own queue.
 *
 * Transitions handled:
 *   - pending_ingestion → processing : isPendingIngestion=false, isIngesting=true
 *   - processing       → complete   : isIngesting=false (existing SSE /
 *                                     fetch pipeline fills in artifacts).
 *   - pending_ingestion → complete  : both flags clear (skeleton tiers
 *                                     can flip straight to complete).
 *
 * This hook ONLY toggles flags. It doesn't refetch entry bodies — that's
 * the existing flow's job when the user opens the panel.
 */

import { useEffect } from "react";
import { getSupabaseBrowser } from "@/shared/supabase/browser";
import { useCanvas } from "./canvas-store";

type EntriesRow = {
  id: string;
  status: string;
  ingested_by: string | null;
};

export function useEntriesRealtime() {
  const { dispatch } = useCanvas();

  useEffect(() => {
    const supabase = getSupabaseBrowser();
    let unsub = () => {};
    let cancelled = false;

    supabase.auth.getUser().then((res: { data: { user: { id: string } | null } }) => {
      if (cancelled) return;
      const userId = res.data.user?.id;
      if (!userId) return; // Not signed in — nothing to subscribe to.

      // The Supabase JS `.on()` overloads for postgres_changes use a
      // looser runtime-typed signature; cast through `any` for the
      // channel.on call so the handler payload stays typed without the
      // SDK's overload signature complaining.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const chan = supabase.channel(`entries-realtime-${userId}`) as any;
      const channel = chan
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "entries",
            filter: `ingested_by=eq.${userId}`,
          },
          (payload: { new: EntriesRow; old: EntriesRow }) => {
            const next = payload.new?.status;
            const prev = payload.old?.status;
            const entryId = payload.new?.id;
            if (!entryId || next === prev) return;

            if (next === "processing") {
              dispatch({
                type: "SET_ENTRY_STATUS_FROM_REALTIME",
                entryId,
                isPendingIngestion: false,
                isIngesting: true,
              });
            } else if (next === "complete") {
              dispatch({
                type: "SET_ENTRY_STATUS_FROM_REALTIME",
                entryId,
                isPendingIngestion: false,
                isIngesting: false,
              });
            } else if (next === "pending_ingestion") {
              // Covers the prepare-failure revert path.
              dispatch({
                type: "SET_ENTRY_STATUS_FROM_REALTIME",
                entryId,
                isPendingIngestion: true,
                isIngesting: false,
              });
            }
          },
        )
        .subscribe();

      unsub = () => {
        supabase.removeChannel(channel);
      };
    });

    return () => {
      cancelled = true;
      unsub();
    };
  }, [dispatch]);
}
