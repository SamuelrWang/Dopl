"use client";

/**
 * use-canvas-sync.ts — Syncs entry panels between the client-side canvas
 * (localStorage/reducer) and the server-side canvas_panels table.
 *
 * Merge-on-load:
 *   - Server entries not in local → fetch full entry data → spawn panel
 *   - If entry fetch 404s → delete orphaned canvas_panels row (cleanup)
 *   - Local entry panels not on server → push to server
 *   - Both have same entryId → keep local version (richer snapshot)
 *
 * Change tracking:
 *   - New local entries → POST to server
 *   - Removed local entries → DELETE from server
 */

import { useEffect, useRef } from "react";
import { useCanvas } from "./canvas-store";
import type { EntryPanelData } from "./types";
import type { FullEntryResponse } from "./add-to-canvas";

interface ServerPanel {
  id: string;
  entry_id: string;
  title: string | null;
  summary: string | null;
  source_url: string | null;
  x: number;
  y: number;
  added_at: string;
}

export function useCanvasSync() {
  const { state, dispatch } = useCanvas();
  const syncedRef = useRef(false);
  const prevEntryIdsRef = useRef<Set<string>>(new Set());

  // ── Merge-on-load (runs once) ────────────────────────────────────
  useEffect(() => {
    if (syncedRef.current) return;
    syncedRef.current = true;

    async function mergeOnLoad() {
      try {
        const res = await fetch("/api/canvas/panels");
        if (!res.ok) return;

        const { panels: serverPanels }: { panels: ServerPanel[] } =
          await res.json();

        const localEntryIds = new Set(
          state.panels
            .filter((p): p is EntryPanelData => p.type === "entry")
            .map((p) => p.entryId)
        );

        const serverEntryIds = new Set(serverPanels.map((p) => p.entry_id));

        // Server has entries not in local → spawn them
        const toFetch = serverPanels.filter(
          (sp) => !localEntryIds.has(sp.entry_id)
        );

        for (const sp of toFetch) {
          try {
            const entryRes = await fetch(`/api/entries/${sp.entry_id}`);
            if (!entryRes.ok) {
              // Entry no longer exists — clean up the orphaned canvas_panels row
              fetch(`/api/canvas/panels/${sp.entry_id}`, {
                method: "DELETE",
              }).catch(() => {});
              serverEntryIds.delete(sp.entry_id);
              continue;
            }
            const entry: FullEntryResponse = await entryRes.json();

            dispatch({
              type: "SPAWN_ENTRY_PANEL",
              entryId: entry.id,
              title: entry.title || "Untitled Setup",
              summary: entry.summary ?? null,
              sourceUrl: entry.source_url ?? "",
              sourcePlatform: entry.source_platform ?? null,
              sourceAuthor: entry.source_author ?? null,
              thumbnailUrl: entry.thumbnail_url ?? null,
              useCase: entry.use_case ?? null,
              complexity: entry.complexity ?? null,
              tags: (entry.tags ?? []).map((t) => ({
                type: t.tag_type,
                value: t.tag_value,
              })),
              readme: entry.readme || "",
              agentsMd: entry.agents_md || "",
              manifest: entry.manifest || {},
              sourcePanelId: "", // no source panel
              position: { x: sp.x, y: sp.y },
            });
          } catch {
            // Network error — skip but don't delete (might be transient)
          }
        }

        // Local entry panels not on server → push to server
        const toPush = state.panels.filter(
          (p): p is EntryPanelData =>
            p.type === "entry" && !serverEntryIds.has(p.entryId)
        );

        for (const lp of toPush) {
          try {
            await fetch("/api/canvas/panels", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ entry_id: lp.entryId }),
            });
          } catch {
            // Best-effort push
          }
        }

        // Initialize tracking set
        prevEntryIdsRef.current = new Set([
          ...localEntryIds,
          ...serverEntryIds,
        ]);
      } catch {
        // Sync is best-effort
      }
    }

    mergeOnLoad();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Track local changes → push to server ─────────────────────────
  useEffect(() => {
    if (!syncedRef.current) return;

    const currentEntryIds = new Set(
      state.panels
        .filter((p): p is EntryPanelData => p.type === "entry")
        .map((p) => p.entryId)
    );

    const prev = prevEntryIdsRef.current;

    // New entries added locally → push to server
    for (const eid of currentEntryIds) {
      if (!prev.has(eid)) {
        fetch("/api/canvas/panels", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ entry_id: eid }),
        }).catch(() => {});
      }
    }

    // Entries removed locally → delete from server
    for (const eid of prev) {
      if (!currentEntryIds.has(eid)) {
        fetch(`/api/canvas/panels/${eid}`, {
          method: "DELETE",
        }).catch(() => {});
      }
    }

    prevEntryIdsRef.current = currentEntryIds;
  }, [state.panels]);
}
