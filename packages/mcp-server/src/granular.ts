/**
 * Serving a granular tool (DMP-013) from its manifest row: its input schema, its placeholder
 * description, and the rewrite of a call into the bound legacy call. The registrar validates that
 * call against the legacy tool's own schema and runs the legacy pipeline, so every gate, charge and
 * tally sees legacy keys.
 */

import type { ZodRawShape, ZodType } from "zod";
import { z } from "zod";

import { bindingsOf, parseBinding, selectorOf, takesContainer, type GranularTool } from "./tool-manifest.js";
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
export function granularShape(t: GranularTool, legacy: ReadonlyMap<string, LegacyTool>): ZodRawShape | null {
  const found = bindingsOf(t).map((key) => legacy.get(parseBinding(key).tool)?.shape);
  if (found.includes(undefined)) return null;
  const shapes = found as ZodRawShape[];
  const shape: Record<string, ZodType> = {};
  const selector = selectorOf(t);
  if (selector) {
    const jobs = z.enum(Object.keys(t.bind) as [string, ...string[]]);
    shape[selector] = t.selectDefault ? jobs.default(t.selectDefault) : jobs;
  }
  for (const param of takesContainer(t) ? [...t.params, "container"] : t.params) {
    const owner = shapes.find((s) => param in s);
    if (!owner) throw new Error(`${t.name}: no bound legacy tool publishes "${param}"`);
    shape[param] = owner[param] as ZodType;
  }
  return shape;
}

/** Placeholder until B3 writes the prose: the name as a sentence ("dopl_get_map" → "Get map."). */
export function granularDescription(t: GranularTool): string {
  const words = t.name.replace(/^dopl_/, "").replace(/_/g, " ");
  return `${words[0].toUpperCase()}${words.slice(1)}.`;
}

/** The legacy tool and args a granular call stands for: selector consumed, preset and op/action written. */
export function legacyCall(t: GranularTool, args: Record<string, unknown>): { tool: string; args: Record<string, unknown> } {
  const selector = selectorOf(t);
  const { [selector ?? ""]: job, ...rest } = args;
  const { tool, op } = parseBinding(typeof t.bind === "string" ? t.bind : t.bind[job as string]);
  const [base, action] = op === undefined ? [] : op.split(".");
  return {
    tool,
    args: { ...rest, ...t.preset, ...(base !== undefined && { op: base }), ...(action !== undefined && { action }) },
  };
}
