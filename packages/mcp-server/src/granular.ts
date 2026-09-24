/**
 * Serving a granular tool (DMP-013) from its manifest row and its text: the input schema, the
 * description, and the rewrite of a call into the bound legacy call. The registrar validates that
 * call against the legacy tool's own schema and runs the legacy pipeline, so every gate, charge and
 * tally sees legacy keys.
 */

import type { ZodRawShape, ZodType } from "zod";
import { z } from "zod";

import { parseBinding, selectorOf, type BindingKey, type GranularTool } from "./tool-manifest.js";
import { FENCE_POINTER, GRANULAR_TEXT, SHARED_PARAMS } from "./granular-text.js";
import { bindingTakesContainer } from "./workspace-arg.js";
import type { ToolResponse } from "./tools/respond.js";

/** A registered legacy tool: its published shape, its strict input schema, its whole call pipeline. */
export interface LegacyTool {
  shape: ZodRawShape;
  input: ZodType;
  run: (args: Record<string, unknown>) => Promise<ToolResponse>;
}

/** The bound jobs this connection serves, as [selector value, binding]; null value for a one-job tool. */
function servedJobs(t: GranularTool, legacy: ReadonlyMap<string, LegacyTool>): Array<[string | null, BindingKey]> {
  const jobs: Array<[string | null, BindingKey]> = typeof t.bind === "string" ? [[null, t.bind]] : Object.entries(t.bind);
  // A job whose legacy tool the profile did not offer is not served (dopl_only drops the channel guide).
  return jobs.filter(([, key]) => legacy.has(parseBinding(key).tool));
}

/** The resource a pulled job answers with, or undefined for a bound job. */
export function pulledResource(t: GranularTool, args: Record<string, unknown>): string | undefined {
  const selector = selectorOf(t);
  return selector ? t.pulled?.[args[selector] as string] : undefined;
}

/** The param as published: this tool's type or its legacy owner's, re-described, required or optional. */
function publish(schema: ZodType, description: string, required: boolean): ZodType {
  const inner = schema instanceof z.ZodOptional ? (schema.unwrap() as ZodType) : schema;
  const described = inner.describe(description);
  return required ? described : described.optional();
}

/**
 * The row's params, typed by the tool's text or the first served legacy tool that publishes them,
 * plus the selector over the served jobs. Null when no job is served on this connection.
 */
export function granularShape(t: GranularTool, legacy: ReadonlyMap<string, LegacyTool>): ZodRawShape | null {
  const jobs = servedJobs(t, legacy);
  if (jobs.length === 0) return null;
  const text = GRANULAR_TEXT[t.name];
  const shapes = jobs.map(([, key]) => legacy.get(parseBinding(key).tool)!.shape);
  const shape: Record<string, ZodType> = {};
  const selector = selectorOf(t);
  if (selector) {
    // A pulled job rides with the bound ones: the tool is offered only for a served binding.
    const names = [...jobs.map(([job]) => job!), ...Object.keys(t.pulled ?? {})] as [string, ...string[]];
    const line = text.params?.[selector];
    const select = line ? z.enum(names).describe(line) : z.enum(names);
    shape[selector] = t.selectDefault && names.includes(t.selectDefault) ? select.default(t.selectDefault) : select;
  }
  const container = jobs.some(([, key]) => bindingTakesContainer(key));
  for (const param of [...t.params, ...(t.carry ?? []), ...(container ? ["container"] : [])]) {
    const type = text.types?.[param] ?? shapes.find((s) => param in s)?.[param];
    // A param only an unserved job takes goes with that job.
    if (!type) continue;
    shape[param] = publish(type as ZodType, text.params?.[param] ?? SHARED_PARAMS[param], text.required?.includes(param) === true);
  }
  return shape;
}

export function granularDescription(t: GranularTool): string {
  const text = GRANULAR_TEXT[t.name];
  return text.fenced ? `${text.description} ${FENCE_POINTER}` : text.description;
}

/**
 * The legacy tool and args a granular call stands for: selector consumed, preset and op/action
 * written. `carried` are the params the legacy schema does not take, handed to its handler as-is.
 */
export function legacyCall(
  t: GranularTool,
  args: Record<string, unknown>,
): { tool: string; args: Record<string, unknown>; carried: Record<string, unknown> } {
  const selector = selectorOf(t);
  const rest: Record<string, unknown> = {};
  const carried: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (key === selector) continue;
    (t.carry?.includes(key) ? carried : rest)[key] = value;
  }
  const { tool, op } = parseBinding(typeof t.bind === "string" ? t.bind : t.bind[args[selector!] as string]);
  const [base, action] = op === undefined ? [] : op.split(".");
  return {
    tool,
    args: { ...rest, ...t.preset, ...(base !== undefined && { op: base }), ...(action !== undefined && { action }) },
    carried,
  };
}
