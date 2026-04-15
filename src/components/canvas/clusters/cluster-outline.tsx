"use client";

/**
 * ClusterOutline — SVG <path> that traces the rectilinear union of a
 * cluster's member panels with rounded corners and a dashed stroke.
 *
 * Rendered INSIDE the world div (world-space) so the outline scales with
 * zoom. The SVG is sized to the cluster's outer bounding box with a
 * little breathing room for the stroke width.
 *
 * pointer-events: none — the canvas's pointerdown handler hit-tests
 * clusters in JS against the world-space bounds. The outline is purely
 * visual; the header tab and the hit-test logic are what actually handle
 * input.
 */

import React from "react";
import type { Panel } from "../types";
import { CLUSTER_PADDING } from "../types";
import {
  clusterBounds,
  computeClusterOutline,
  outlineToRoundedPath,
} from "./cluster-geometry";

interface ClusterOutlineProps {
  panels: Panel[];
  /** When true, use a brighter stroke to indicate selection/hover. */
  emphasised?: boolean;
}

export const ClusterOutline = React.memo(function ClusterOutline({ panels, emphasised = false }: ClusterOutlineProps) {
  if (panels.length === 0) return null;

  // Multiple polygons when the cluster's padded rects form more than one
  // connected component (e.g. a member is far enough from the rest that
  // its padded bounds don't touch). The tracer returns ALL components so
  // the outline hugs every member, even outliers.
  const outlines = computeClusterOutline(panels);
  if (outlines.length === 0) return null;

  const path = outlineToRoundedPath(outlines);
  if (!path) return null;

  // SVG viewbox = cluster outer bounds + a small inset for the stroke so
  // the dashes don't get clipped at the edges.
  const bounds = clusterBounds(panels);
  const strokeInset = 4;
  const vbX = bounds.x - strokeInset;
  const vbY = bounds.y - strokeInset;
  const vbW = bounds.width + strokeInset * 2;
  const vbH = bounds.height + strokeInset * 2;

  const strokeColor = emphasised
    ? "rgba(255,255,255,0.5)"
    : "rgba(255,255,255,0.35)";
  const fillColor = emphasised
    ? "rgba(255,255,255,0.05)"
    : "rgba(255,255,255,0.03)";

  return (
    <svg
      aria-hidden
      className="absolute"
      style={{
        // Absolute-positioned inside the world div at the SVG's world
        // origin so the inline `viewBox` maps 1:1 to world coords.
        left: vbX,
        top: vbY,
        width: vbW,
        height: vbH,
        overflow: "visible",
        // Allow pointer events on the fill hit area but not on empty SVG space.
        pointerEvents: "none",
      }}
      viewBox={`${vbX} ${vbY} ${vbW} ${vbH}`}
    >
      {/* Invisible hit area — grab cursor on the cluster fill region.
          pointer-events: fill so only the filled shape responds, not the
          entire SVG bounding box. */}
      <path
        d={path}
        fill="transparent"
        stroke="transparent"
        strokeWidth={CLUSTER_PADDING}
        style={{ pointerEvents: "fill", cursor: "grab" }}
      />
      {/* Visual outline */}
      <path
        d={path}
        fill={fillColor}
        stroke={strokeColor}
        strokeWidth={1.5}
        strokeDasharray="8 6"
        strokeLinejoin="round"
        strokeLinecap="round"
        style={{ pointerEvents: "none" }}
      />
    </svg>
  );
});

/**
 * Re-export for test / hit-test callers who need the bounds without
 * rendering.
 */
export { clusterBounds };
export const CLUSTER_OUTLINE_PADDING = CLUSTER_PADDING;
