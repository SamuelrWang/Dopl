/**
 * EVERY CALL SPELLING AN AGENT READS, rendered for the connection's active tool set (DMP-013).
 * A spelling is named by its manifest key (`channel.read`, `kb.write_file`, `channel.rooms.help`:
 * a binding key without the `dopl_` prefix, `:` as `.`) and rendered from `tool-manifest.ts`, so
 * `dopl_channel(op="read", …)` on a legacy connection is `dopl_read_channel(…)` on a granular one
 * with no second table. `call-spelling.test.ts` bans a hand-written spelling anywhere else in `src`.
 *
 * The active set rides an AsyncLocalStorage scope the registrar opens around every tool call and
 * resource read (`withToolSet`), so a handler, a refusal or a footer renders for ITS connection
 * without the set threaded through a signature. Outside any scope (an import-time constant, a
 * legacy description, a unit test) the set is `legacy`.
 */
import { type ToolSet } from "./tool-manifest.js";
/**
 * Run `fn` with `set` active for everything it renders, awaited continuations included. `tool` names
 * the granular call it came through (`dopl_browse_knowledge(action="tree")`); null for a legacy call
 * or a resource read.
 */
export declare function withToolSet<T>(set: ToolSet, fn: () => T, tool?: string | null): T;
export declare function activeToolSet(): ToolSet;
/**
 * The call being answered, named back to its caller: the granular call it came through, else the
 * legacy op as the caller spelled it — `op="export"`, after `legacy.tool` (`dopl_kb op="grant"`), or
 * as a call (`dopl_kb(op="grant")`).
 */
export declare function calledAs(op: string, legacy?: {
    tool?: string;
    form?: "named" | "call";
}): string;
/**
 * Marks text only a LEGACY call can reach (an answer to a legacy-only arg or op), which keeps its
 * legacy spelling; `call-spelling.test.ts` skips what it wraps. Never for text a granular call reaches.
 */
export declare function legacyOnly(text: string): string;
/** Prose that differs by set beyond a call spelling (a renamed param, a sentence about ops). */
export declare function bySet<T>(choices: Readonly<Record<ToolSet, T>>): T;
/** A call's args in order: a string is printed verbatim after `name=`; `true` prints the bare name. */
export type CallArgs = Readonly<Record<string, string | true>>;
export interface CallOptions {
    /**
     * The legacy prose shorthands: `"op"` space-separated, relative to the tool whose text it is in
     * (`op="list_dir"`, `op="restore" revision="<id>"`); `"named"` the same after the tool's name
     * (`dopl_kb op="get_tree" base="notes"`); `"args"` the call's args alone (`op="rooms", action="open"`).
     * A granular tool is its own job, so a granular spelling is always the whole call.
     */
    form?: "call" | "op" | "args" | "named";
    /** The quote around op/action/selector values. Default `"`. */
    quote?: '"' | "'";
}
/** Every key {@link callRef} renders. */
export declare function callKeys(): ReadonlySet<string>;
/** The tool `key` names, bare: `dopl_read_channel` (legacy `dopl_channel`); `args` pick a preset tool. */
export declare function toolName(key: string, args?: CallArgs): string;
/**
 * The granular call that replaces legacy `tool` called with `op` (`Gates.requestedOp`'s key), or null
 * when the call names no manifest job or keeps its name (`dopl_search`). The whole op wins over its
 * base op, so `op="rooms", action="list"` names its own job.
 */
export declare function successorOf(tool: string, op: string | undefined): string | null;
/**
 * `key` called with `args`, spelled for the active set. An op without its action spells, on a
 * granular connection, every tool under it (`dopl_launch_agent / dopl_manage_session`).
 */
export declare function callRef(key: string, args?: CallArgs, options?: CallOptions): string;
