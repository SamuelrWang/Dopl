import { z } from "zod";

/**
 * Zod validation for a persisted graph `layout` (draggable-node positions on
 * the ontology cluster PATCH). Shape `{ [nodeId]: { x, y } }`, finite +
 * bounded. ⚠ Security gate: bounds + node cap keep a malformed or oversized
 * blob (NaN, Infinity, strings, runaway id set) out of the JSONB column —
 * layout is display state, not a payload channel.
 */

/** Max nodes per layout blob — well above any real graph. */
export const MAX_LAYOUT_NODES = 2000;

/** Coordinate clamp — world space is only ever a few thousand px wide. */
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
