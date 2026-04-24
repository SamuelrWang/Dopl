"use client";

/**
 * SharedClusterShell — client-side entry point for the public shared
 * cluster viewer. Renders the EXACT same `<Canvas>` component tree used
 * on /canvas, so visitors see the same rich EntryPanel bodies (readme,
 * agents.md, manifest, tags, actions) as the owner sees on their own
 * canvas.
 *
 * Capability + sync model:
 *   - Non-owner visitors: `syncStrategy="none"`, everything read-only.
 *     NO writes to the user's canvas tables or localStorage.
 *   - Cluster owner:     `syncStrategy="shared"`, can drag panels.
 *     Moves flow to /api/community/[slug]/panels via `onPanelsMove`.
 *
 * The right-side DetailPanel (cluster info + import + chat) is the
 * existing component, unchanged.
 *
 * Unlike /canvas, we do NOT portal the canvas to document.body — this
 * page already establishes its own `fixed inset-0` layout and needs to
 * leave room for the right-side DetailPanel in a flex row.
 */

import { useCallback, useEffect, useMemo } from "react";
import { CanvasProvider, useCanvas } from "@/features/canvas/canvas-store";
import { Canvas } from "@/features/canvas/canvas";
import { MIN_ZOOM, computePanelsBounds } from "@/features/canvas/types";
import { DetailPanel } from "@/features/community/components/detail-panel";
import { publishedClusterToCanvasState } from "@/features/community/server/to-canvas-state";
import type { PublishedClusterDetail } from "@/features/community/server/types";

// Width the DetailPanel overlay reserves on the right side (panel
// width + right gap). Fit-all math uses this to avoid hiding panels
// behind the overlay.
const DETAIL_OVERLAY_RESERVED_PX = 436;

interface Props {
  cluster: PublishedClusterDetail;
  isOwner: boolean;
  /**
   * Whether the visitor has an authenticated session. Decouples
   * "signed-in viewer who isn't the owner" from "logged-out visitor" —
   * the fork CTA needs to surface a Sign-In affordance to the latter
   * rather than auto-redirecting on a post-click 401.
   */
  isAuthenticated: boolean;
  canvasContainerRef: React.RefObject<HTMLDivElement | null>;
}

export default function SharedClusterShell({
  cluster,
  isOwner,
  isAuthenticated,
  canvasContainerRef,
}: Props) {
  // Build the CanvasState once per cluster identity. Re-seeding on every
  // fetched change would reset the reducer and undo the user's pan/zoom.
  const initialState = useMemo(
    () => publishedClusterToCanvasState(cluster),
    // Intentionally keyed by slug only — owner drags mutate `cluster`
    // through setState in the parent, but those mutations are already
    // reflected inside the reducer; we don't want to re-seed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cluster.slug]
  );

  // Owner drag persistence — fire-and-forget PATCH to the existing
  // endpoint. Errors are silent; the reducer keeps the local state, so
  // worst case a hard refresh reverts.
  const handlePanelsMove = useCallback(
    (moves: Array<{ id: string; x: number; y: number }>) => {
      if (!isOwner) return;
      fetch(`/api/community/${encodeURIComponent(cluster.slug)}/panels`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ panels: moves }),
      }).catch(() => {});
    },
    [cluster.slug, isOwner]
  );

  return (
    <CanvasProvider
      // Intentionally no userId — we don't want the canvas store to
      // associate this ephemeral shared view with the logged-in user's
      // localStorage key.
      initialState={initialState}
      initialConversations={[]}
      syncStrategy={isOwner ? "shared" : "none"}
      capabilities={{
        canMove: isOwner,
        canDelete: false,
        canAdd: false,
      }}
      onPanelsMove={isOwner ? handlePanelsMove : undefined}
    >
      {/* Canvas takes the full area. DetailPanel floats on top as a
          rounded, detached overlay — matching the FixedChatPanel look
          on /canvas. 16px gap on all three visible sides. */}
      <div className="flex-1 relative overflow-hidden" ref={canvasContainerRef}>
        <Canvas showMinimap={false} />
        <div
          className="absolute top-4 right-4 bottom-4 z-10"
          style={{ width: 420 }}
        >
          <DetailPanel cluster={cluster} isOwner={isOwner} isAuthenticated={isAuthenticated} />
        </div>
      </div>
      <FitAllOnMountBridge />
    </CanvasProvider>
  );
}

/**
 * Fit-all camera bridge. Runs AFTER Canvas's own mount effect (React
 * runs effects in declaration order, this component is a sibling
 * declared last) and re-centers the camera with proper awareness of
 * the DetailPanel overlay — otherwise panels get centered to the
 * middle of the full viewport and half of them sit hidden behind the
 * overlay on the right.
 *
 * Zoom is clamped to [MIN_ZOOM, 1] — we never zoom IN on tiny
 * clusters (keeps text readable) and never below the reducer's own
 * floor.
 */
function FitAllOnMountBridge() {
  const { state, dispatch } = useCanvas();

  useEffect(() => {
    // Defer one tick to guarantee Canvas's mount effect has committed.
    const t = setTimeout(() => {
      const el = document.querySelector<HTMLElement>(
        "[data-canvas-viewport]"
      );
      if (!el) return;
      const vw = el.clientWidth;
      const vh = el.clientHeight;
      const visibleW = Math.max(320, vw - DETAIL_OVERLAY_RESERVED_PX);

      const bounds = computePanelsBounds(state.panels);
      if (!bounds || bounds.width === 0 || bounds.height === 0) return;

      const MARGIN = 0.9;
      const zoomX = (visibleW * MARGIN) / bounds.width;
      const zoomY = (vh * MARGIN) / bounds.height;
      const zoom = Math.max(MIN_ZOOM, Math.min(zoomX, zoomY, 1));

      dispatch({
        type: "SET_CAMERA",
        camera: {
          x: visibleW / 2 - bounds.centerX * zoom,
          y: vh / 2 - bounds.centerY * zoom,
          zoom,
        },
      });
    }, 0);
    return () => clearTimeout(t);
    // Intentionally run once on mount — panels are seeded from the
    // server and don't change for the lifetime of this page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
