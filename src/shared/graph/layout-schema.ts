import { z } from "zod";

/**
 * Zod validation for a persisted graph `layout` (the draggable-node
 * positions both the ontology cluster PATCH and the workflow PATCH
 * accept). Shape: `{ [nodeId]: { x, y } }` with finite, bounded
 * coordinates. Shared so both routes validate identically.
 *
 * The bounds and node cap keep an over-large or malformed blob (NaN,
 * Infinity, strings, a runaway id set) from ever reaching the JSONB
 * column — a layout is display state, not a place to smuggle payloads.
 */

/** Max nodes in one layout blob — comfortably above any real graph. */
export const MAX_LAYOUT_NODES = 2000;

/** Coordinate clamp — world space is only ever a few thousand px. */
const COORD_LIMIT = 1_000_000;

const finiteCoord = z
  .number()
  .refine((n) => Number.isFinite(n), "must be a finite number")
  .refine((n) => Math.abs(n) <= COORD_LIMIT, "out of bounds");

const nodePositionSchema = z
  .object({ x: finiteCoord, y: finiteCoord })
  .strict();

export const graphLayoutSchema = z
  .record(z.string().min(1).max(200), nodePositionSchema)
  .refine((rec) => Object.keys(rec).length <= MAX_LAYOUT_NODES, {
    message: `layout exceeds ${MAX_LAYOUT_NODES} nodes`,
  });

export type GraphLayoutInput = z.infer<typeof graphLayoutSchema>;
