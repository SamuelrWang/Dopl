/**
 * Serving a granular tool (DMP-013) from its manifest row: its input schema, its placeholder
 * description, and the rewrite of a call into the bound legacy call. The registrar validates that
 * call against the legacy tool's own schema and runs the legacy pipeline, so every gate, charge and
 * tally sees legacy keys.
 */
import type { ZodRawShape, ZodType } from "zod";
import { type GranularTool } from "./tool-manifest.js";
import type { ToolResponse } from "./tools/respond.js";
/** A registered legacy tool: its published shape, its strict input schema, its whole call pipeline. */
export interface LegacyTool {
    shape: ZodRawShape;
    input: ZodType;
    run: (args: Record<string, unknown>) => Promise<ToolResponse>;
}
/**
 * The row's params, each typed by the first bound legacy tool that publishes it, plus the selector.
 * Null when a bound legacy tool is not served on this connection (outside the profile offer).
 */
export declare function granularShape(t: GranularTool, legacy: ReadonlyMap<string, LegacyTool>): ZodRawShape | null;
/** Placeholder until B3 writes the prose: the name as a sentence ("dopl_get_map" → "Get map."). */
export declare function granularDescription(t: GranularTool): string;
/** The legacy tool and args a granular call stands for: selector consumed, preset and op/action written. */
export declare function legacyCall(t: GranularTool, args: Record<string, unknown>): {
    tool: string;
    args: Record<string, unknown>;
};
