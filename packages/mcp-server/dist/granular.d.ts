/**
 * Serving a granular tool (DMP-013) from its manifest row and its text: the input schema, the
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
/** The resource a pulled job answers with, or undefined for a bound job. */
export declare function pulledResource(t: GranularTool, args: Record<string, unknown>): string | undefined;
/**
 * The row's params, typed by the tool's text or the first served legacy tool that publishes them,
 * plus the selector over the served jobs. Null when no job is served on this connection.
 */
export declare function granularShape(t: GranularTool, legacy: ReadonlyMap<string, LegacyTool>): ZodRawShape | null;
export declare function granularDescription(t: GranularTool): string;
/**
 * The legacy tool and args a granular call stands for: selector consumed, preset and op/action
 * written. `carried` are the params the legacy schema does not take, handed to its handler as-is.
 */
export declare function legacyCall(t: GranularTool, args: Record<string, unknown>): {
    tool: string;
    args: Record<string, unknown>;
    carried: Record<string, unknown>;
};
