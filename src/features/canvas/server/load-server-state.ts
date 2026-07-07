/**
 * load-server-state.ts — Server-side loader for the canvas' initial
 * state. Used by the server-rendered canvas page to fetch everything
 * the client reducer needs before the HTML is sent, eliminating the
 * client-side hydration race entirely.
 *
 * The loader `never throws`. Failures degrade to empty-but-valid state
 * so a transient Supabase hiccup can't block the page render.
 *
 * The API route (/api/canvas/state) also calls this loader so the HTTP
 * path and the server-render path share one source of truth — same
 * queries, same response shape, same side effects.
 */

import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import { dbRowToPanel } from "./panel-dto";
import {
  dedupSingletonPanels,
  ensureDefaultPanels,
} from "./defaults";
import type { CanvasState, Panel } from "@/features/canvas/types";
import { INITIAL_CANVAS_STATE } from "@/features/canvas/types";

// ── Canvas state loader ──────────────────────────────────────────────

/**
 * Load a user's full canvas state from Supabase, apply singleton-dedup
 * and default-panel invariants. Return a `CanvasState` ready to seed
 * `useReducer`.
 *
 * Guarantees:
 *   - Always returns a valid CanvasState (empty + defaults on any error).
 *   - Runs `dedupSingletonPanels` + `ensureDefaultPanels` before return
 *     so the connection panel is always present (single instance). The
 *     browse panel is no longer auto-injected — it opens on demand.
 */
export async function loadCanvasInitialState(scope: {
  userId: string;
  workspaceId: string;
}): Promise<CanvasState> {
  const empty: CanvasState = {
    ...INITIAL_CANVAS_STATE,
    selectedPanelIds: [],
    history: { past: [], future: [] },
  };

  try {
    const supabase = supabaseAdmin();

    const [stateRes, panelsRes, edgesRes] = await Promise.all([
      supabase
        .from("canvas_state")
        .select("*")
        .eq("workspace_id", scope.workspaceId)
        .maybeSingle(),
      supabase.from("canvas_panels").select("*").eq("workspace_id", scope.workspaceId),
      // Edge load failure (e.g. migration not applied yet) degrades to
      // an empty edge list rather than nuking the whole canvas state.
      supabase
        .from("canvas_edges")
        .select("id, from_panel_id, to_panel_id")
        .eq("workspace_id", scope.workspaceId),
    ]);

    // 404 / first-time user → return empty state with defaults injected.
    if (stateRes.error || !stateRes.data) {
      return dedupSingletonPanels(ensureDefaultPanels(empty));
    }

    const cs = stateRes.data as {
      camera_x: number;
      camera_y: number;
      camera_zoom: number;
      next_panel_id: number;
    };
    const dbPanels = panelsRes.data || [];

    // Deserialize panels, drop any row that doesn't map (shouldn't happen,
    // but guard against future schema drift).
    const panels: Panel[] = [];
    for (const row of dbPanels) {
      const panel = dbRowToPanel(row as Record<string, unknown>);
      if (panel) panels.push(panel);
    }

    const panelIds = new Set(panels.map((p) => p.id));
    const edges = (edgesRes.error ? [] : edgesRes.data ?? [])
      .map((row) => ({
        id: row.id as string,
        fromPanelId: row.from_panel_id as string,
        toPanelId: row.to_panel_id as string,
      }))
      // Drop edges whose endpoint panels are gone (deleted in another
      // session before the DB cascade caught up).
      .filter((ed) => panelIds.has(ed.fromPanelId) && panelIds.has(ed.toPanelId));

    const state: CanvasState = {
      ...empty,
      camera: {
        x: cs.camera_x ?? 0,
        y: cs.camera_y ?? 0,
        zoom: cs.camera_zoom ?? 1,
      },
      panels,
      edges,
      // Clamp the counter against what's actually loaded: the panel
      // POSTs are immediate but the counter only persists via a
      // debounced PATCH that can be lost (409 / tab close). A stale
      // counter would mint duplicate `panel-N` ids — colliding React
      // keys, silently-ignored POSTs, and panel_data writes landing in
      // the wrong row.
      nextPanelId: Math.max(
        cs.next_panel_id ?? 1,
        maxNumericSuffix(panels.map((p) => p.id), "panel-") + 1
      ),
    };

    const finalState = dedupSingletonPanels(ensureDefaultPanels(state));

    // ── Reconciliation: the DB must mirror the canvas the user sees ──
    // Rows that didn't make it into the composed state (failed historical
    // deletes, legacy/unknown panel types dropped by dbRowToPanel,
    // singleton duplicates) would otherwise live forever — invisible on
    // the canvas but still listed to agents via dopl_canvas/the API.
    // Deleting them here makes every canvas load self-healing.
    const keepIds = new Set(finalState.panels.map((p) => p.id));
    const strayIds = dbPanels
      .map((r) => (r as { panel_id: string }).panel_id)
      .filter((id) => !keepIds.has(id));
    if (strayIds.length > 0) {
      const { error: strayErr } = await supabase
        .from("canvas_panels")
        .delete()
        .eq("workspace_id", scope.workspaceId)
        .in("panel_id", strayIds);
      if (strayErr) {
        console.error("[canvas-load] stray panel cleanup failed:", strayErr);
      } else {
        console.warn(
          `[canvas-load] reconciled ${strayIds.length} stray canvas_panels row(s):`,
          strayIds
        );
      }
    }

    return finalState;
  } catch {
    return dedupSingletonPanels(ensureDefaultPanels(empty));
  }
}

/** Largest numeric suffix among ids shaped `${prefix}${n}`; 0 if none. */
function maxNumericSuffix(ids: string[], prefix: string): number {
  let max = 0;
  for (const id of ids) {
    if (!id.startsWith(prefix)) continue;
    const n = Number(id.slice(prefix.length));
    if (Number.isInteger(n) && n > max) max = n;
  }
  return max;
}
