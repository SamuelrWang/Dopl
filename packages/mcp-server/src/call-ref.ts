/**
 * EVERY CALL SPELLING AN AGENT READS, rendered for the connection's active tool set (DMP-013 B3).
 * A spelling is named by its manifest key (`channel.read`, `kb.write_file`, `channel.rooms.help`:
 * a binding key without the `dopl_` prefix, `:` as `.`) and rendered from `tool-manifest.ts`, so
 * `dopl_channel(op="read", …)` on a legacy connection is `dopl_read_channel(…)` on a granular one
 * with no second table. `call-ref.test.ts` bans a hand-written spelling anywhere else in `src`.
 *
 * The active set rides an AsyncLocalStorage scope the registrar opens around every tool call and
 * resource read (`withToolSet`), so a handler, a refusal or a footer renders for ITS connection
 * without the set threaded through a signature. Outside any scope (an import-time constant, a
 * legacy description, a unit test) the set is `legacy`, the default.
 */

import { AsyncLocalStorage } from "node:async_hooks";

import {
  GRANULAR_TOOLS,
  selectorOf,
  TOOL_SETS,
  type GranularTool,
  type ToolSet,
} from "./tool-manifest.js";

/** What a call runs under: its connection's set, and the granular tool it came through, if any. */
interface CallScope {
  set: ToolSet;
  tool: string | null;
}

const scope = new AsyncLocalStorage<CallScope>();

/**
 * Run `fn` with `set` active for everything it renders, awaited continuations included. `tool` is
 * the granular tool the call came through; null for a legacy call or a resource read.
 */
export function withToolSet<T>(set: ToolSet, fn: () => T, tool: string | null = null): T {
  return scope.run({ set, tool }, fn);
}

export function activeToolSet(): ToolSet {
  return scope.getStore()?.set ?? TOOL_SETS[0];
}

/**
 * The call being answered, named back to its caller: the granular tool it came through, else the
 * legacy op label as the caller spelled it (`op="export"`).
 */
export function calledAs(opLabel: string): string {
  return scope.getStore()?.tool ?? `op="${opLabel}"`;
}

/** Prose that differs by set beyond a call spelling (a renamed param, a sentence about ops). */
export function bySet<T>(choices: Readonly<Record<ToolSet, T>>): T {
  return choices[activeToolSet()];
}

/** A call's args in order: a string is printed verbatim after `name=`; `true` prints the bare name. */
export type CallArgs = Readonly<Record<string, string | true>>;

export interface CallOptions {
  /**
   * `"op"`: the legacy spelling relative to its own tool, for a hint inside that tool's own text —
   * `op="list_dir"`, or `op="rooms" action="list"` where there is an action. A granular tool is its own
   * job, so a granular spelling is always the whole call.
   */
  form?: "call" | "op";
  /** The quote around op/action/selector values. Default `"`. */
  quote?: '"' | "'";
}

interface Target {
  tool: GranularTool;
  /** The selector value that picks this job, or null for a one-job tool. */
  job: string | null;
}

/**
 * Manifest key → every granular tool that runs it (two only for a `preset` binding). Built on first
 * use: `tool-manifest.ts` imports the gates, which import renderers that import this module.
 */
let targets: ReadonlyMap<string, readonly Target[]> | null = null;

function targetMap(): ReadonlyMap<string, readonly Target[]> {
  if (targets) return targets;
  const map = new Map<string, Target[]>();
  for (const tool of GRANULAR_TOOLS) {
    const jobs: Array<[string | null, string]> =
      typeof tool.bind === "string" ? [[null, tool.bind]] : Object.entries(tool.bind);
    for (const [job, binding] of jobs) {
      const key = binding.slice("dopl_".length).replace(":", ".");
      map.set(key, [...(map.get(key) ?? []), { tool, job }]);
    }
  }
  return (targets = map);
}

/** Every key {@link callRef} renders. */
export function callKeys(): ReadonlySet<string> {
  return new Set(targetMap().keys());
}

function targetsOf(key: string): readonly Target[] {
  const found = targetMap().get(key);
  if (!found) throw new Error(`callRef: "${key}" is not a manifest key`);
  return found;
}

/** A preset binding (`dopl_request_decision`) is picked when the args carry its preset. */
function pick(targets: readonly Target[], args: CallArgs): Target {
  const unquote = (v: string | true) => (typeof v === "string" ? v.replace(/^["']|["']$/g, "") : v);
  const presetMatch = (t: Target) =>
    Object.entries(t.tool.preset ?? {}).every(([k, v]) => unquote(args[k] ?? "") === v);
  return targets.find((t) => t.tool.preset && presetMatch(t)) ?? targets.find((t) => !t.tool.preset)!;
}

function argText(args: CallArgs, skip: Readonly<Record<string, string>> = {}): string[] {
  return Object.entries(args)
    .filter(([name]) => !(name in skip))
    .map(([name, value]) => (value === true ? name : `${name}=${value}`));
}

/** The granular tool `key` names, bare: `dopl_read_channel`. Legacy: `dopl_channel`. */
export function toolName(key: string): string {
  if (activeToolSet() === "legacy") return `dopl_${key.split(".")[0]}`;
  return pick(targetsOf(key), {}).tool.name;
}

/** `key` called with `args`, spelled for the active set. */
export function callRef(key: string, args: CallArgs = {}, options: CallOptions = {}): string {
  const found = targetsOf(key);
  const q = options.quote ?? '"';
  if (activeToolSet() === "legacy") {
    const [tool, op, action] = key.split(".");
    const act = action === undefined ? "" : `action=${q}${action}${q}`;
    if (options.form === "op") return [[`op=${q}${op}${q}`, ...(act ? [act] : [])].join(" "), ...argText(args)].join(", ");
    const parts = [...(op === undefined ? [] : [`op=${q}${op}${q}`]), ...(act ? [act] : []), ...argText(args)];
    return `dopl_${tool}(${parts.join(", ")})`;
  }
  const { tool, job } = pick(found, args);
  const selector = selectorOf(tool);
  const parts = [...(selector && job ? [`${selector}=${q}${job}${q}`] : []), ...argText(args, tool.preset)];
  return `${tool.name}(${parts.join(", ")})`;
}

/**
 * A spelling rendered when it is PRINTED, not when it is built: for a module constant (an error
 * table's `retry`) that must read in the set of whichever connection prints it.
 */
export class CallRef {
  constructor(
    readonly key: string,
    readonly args: CallArgs = {},
    readonly options: CallOptions = {},
  ) {}

  toString(): string {
    return callRef(this.key, this.args, this.options);
  }
}

/** Shorthand for a lazy {@link CallRef}. */
export function ref(key: string, args?: CallArgs, options?: CallOptions): CallRef {
  return new CallRef(key, args, options);
}

