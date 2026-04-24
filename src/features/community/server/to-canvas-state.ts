/**
 * Transform a published (shared) cluster snapshot into a CanvasState
 * that the `/canvas` rendering stack can consume directly.
 *
 * The shared-cluster viewer (`/community/[slug]`) used to render a
 * parallel stripped-down component tree (`PublishedCanvas` +
 * `PublishedEntryCard`) that showed only title + summary + source URL.
 * We now render the exact same components as `/canvas` — this module
 * is the seam: it maps the published API payload into the canvas's
 * internal shape so `<CanvasProvider initialState={...}>` just works.
 *
 * Invariant: pure function, no side effects, no fetches. Everything it
 * needs is already in the `PublishedClusterDetail` payload (the API
 * returns readme + agents.md + manifest + tags + metadata inline).
 */

import type {
  CanvasState,
  Cluster,
  EntryPanelData,
  Panel,
} from "@/components/canvas/types";
import {
  ENTRY_PANEL_SIZE,
  MIN_ZOOM,
  computePanelsBounds,
} from "@/components/canvas/types";
import type { PublishedClusterDetail } from "./types";

/**
 * Convert a `PublishedClusterDetail` into a full `CanvasState`. The
 * camera is seeded to fit-all so opening the page shows the whole
 * cluster centered by default.
 *
 * @param detail  API response for a shared cluster
 * @param viewport  optional { width, height } for fit-all centering.
 *   Falls back to an assumed 1440×900 viewport when called server-side
 *   or before the browser has measured the canvas container. The user
 *   can pan/zoom from there.
 */
export function publishedClusterToCanvasState(
  detail: PublishedClusterDetail,
  viewport?: { width: number; height: number }
): CanvasState {
  const entriesById = new Map(detail.entries.map((e) => [e.entry_id, e]));

  // Build an EntryPanelData for each published panel. Panels whose
  // entries didn't come back (e.g. removed / unapproved) are dropped —
  // they'd render as empty cards.
  const panels: Panel[] = [];
  for (const p of detail.panels) {
    const entry = entriesById.get(p.entry_id);
    if (!entry) continue;

    const tags = (entry.tags || []).map((t) => ({
      type: t.tag_type,
      value: t.tag_value,
    }));

    const width = p.width || ENTRY_PANEL_SIZE.width;
    const height = p.height || ENTRY_PANEL_SIZE.height;

    const entryPanel: EntryPanelData = {
      id: p.id,
      type: "entry",
      x: p.x,
      y: p.y,
      width,
      height,
      entryId: entry.entry_id,
      title: entry.title || p.title || "Untitled",
      summary: entry.summary ?? p.summary ?? null,
      sourceUrl: entry.source_url ?? p.source_url ?? "",
      sourcePlatform: entry.source_platform ?? null,
      sourceAuthor: entry.source_author ?? null,
      thumbnailUrl: entry.thumbnail_url ?? null,
      useCase: entry.use_case ?? null,
      complexity: entry.complexity ?? null,
      contentType: entry.content_type ?? null,
      tags,
      readme: entry.readme ?? "",
      agentsMd: entry.agents_md ?? "",
      manifest: (entry.manifest ?? {}) as Record<string, unknown>,
      createdAt: entry.created_at ?? new Date().toISOString(),
      // Snapshot is complete — no skeleton states.
      readmeLoading: false,
      agentsMdLoading: false,
      tagsLoading: false,
      isIngesting: false,
    };

    panels.push(entryPanel);
  }

  // Wrap every panel in a single cluster so the main Canvas draws the
  // cluster outline + header tab automatically (the same rendering the
  // user gets on their own canvas for a manually-created cluster).
  const clusters: Cluster[] = [];
  if (panels.length >= 2) {
    clusters.push({
      id: `shared-cluster-${detail.id}`,
      name: detail.title,
      panelIds: panels.map((p) => p.id),
      createdAt: detail.created_at,
      dbId: detail.id,
      slug: detail.slug,
      // Mark the cluster as already-published so the cluster header
      // menu shows "Copy share link" (gated on publishedSlug) and
      // suppresses "Publish" (gated on !publishedSlug). Capability
      // flags separately hide mutation actions (Rename / Uncluster /
      // Delete) from visitors.
      publishedSlug: detail.slug,
    });
  }

  // Fit-all camera — compute a zoom level that shows every panel
  // on-screen with some margin. User complaint: the shared canvas
  // was opening zoomed-in, forcing people to scroll around to see
  // what the cluster contained. Now it opens fully zoomed out to the
  // bounding box on first paint, and Canvas's one-time mount effect
  // preserves this zoom while re-centering with the real viewport.
  const bounds = computePanelsBounds(panels);
  const vpW = viewport?.width ?? 1440;
  const vpH = viewport?.height ?? 900;

  // The Detail overlay panel reserves ~436px on the right (420 + 16
  // gap). Account for it so fit-all doesn't hide half the panels
  // behind the overlay. On mobile where the overlay stacks or hides,
  // this is slightly conservative — fine.
  const DETAIL_OVERLAY_WIDTH = 436;
  const MARGIN = 0.9; // 10% breathing room on the visible side
  const effectiveW = Math.max(320, vpW - DETAIL_OVERLAY_WIDTH);

  let fitZoom = 1;
  if (bounds && bounds.width > 0 && bounds.height > 0) {
    const zoomX = (effectiveW * MARGIN) / bounds.width;
    const zoomY = (vpH * MARGIN) / bounds.height;
    // Never zoom IN on small clusters (cap at 1), never go below
    // MIN_ZOOM (reducer would clamp anyway).
    fitZoom = Math.min(zoomX, zoomY, 1);
    fitZoom = Math.max(fitZoom, MIN_ZOOM);
  }

  const camera = bounds
    ? {
        // Center on the visible area (which starts at x=0 and ends
        // at effectiveW) rather than the full viewport.
        x: effectiveW / 2 - bounds.centerX * fitZoom,
        y: vpH / 2 - bounds.centerY * fitZoom,
        zoom: fitZoom,
      }
    : { x: 0, y: 0, zoom: 1 };

  return {
    version: 2,
    camera,
    panels,
    clusters,
    // Counters — the shared viewer never creates new panels, but the
    // reducer still reads these, so give them sane starting values.
    nextPanelId: panels.length + 1,
    nextClusterId: clusters.length + 1,
    selectedPanelIds: [],
    deletedPanelsStack: [],
  };
}
