/**
 * THE GRANULAR TOOL SURFACE (DMP-013), one verb_noun tool per job, and the legacy call each one
 * runs. Nothing serves it yet: B1 registers from this table, and until then the legacy surface is
 * the only one on the wire. Read/write class, annotations and the `container` arg are DERIVED from
 * `gating.ts › isWriteOp`, `delete-policy.ts` and `workspace-arg.ts` — never restated here.
 *
 * A binding key is `Gates.requestedOp`'s grain: `<legacy tool>:<op>` or `<legacy tool>:<op>.<action>`,
 * bare `<legacy tool>` for the three that take no op. `tool-manifest.test.ts` pins coverage (every
 * legacy key bound exactly once, no delete op), the annotation truth and the naming rules.
 */
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
/** The tool sets a connection may ask for (`X-Dopl-Tool-Set`, else `?tools=`); the first is the default. */
export declare const TOOL_SETS: readonly ["legacy", "granular"];
export type ToolSet = (typeof TOOL_SETS)[number];
/** An absent or unplaceable claim gets the default: a set names tools, it grants nothing. */
export declare function resolveToolSet(claimed: string | null | undefined): ToolSet;
export type BindingKey = `dopl_${string}`;
export interface GranularTool {
    name: string;
    /** One key, or selector value → key when the tool does several jobs. */
    bind: BindingKey | Readonly<Record<string, BindingKey>>;
    /** The selector arg's name when `bind` is a record. Default `action`. */
    select?: string;
    /** Args fixed by this tool (a decision is a `send` with `kind="decision"`). */
    preset?: Readonly<Record<string, string>>;
    /** Legacy arg names this tool publishes; `container` is derived, never listed. */
    params: readonly string[];
    /** Overwrites existing content. Never a delete: deletion is app-only. */
    destructive?: true;
    /** A repeat with the same args leaves the same state. */
    idempotent?: true;
    /** Core: Claude keeps it loaded while the rest defer behind ToolSearch ({@link ALWAYS_LOAD_META}). */
    alwaysLoad?: true;
}
/**
 * The per-tool `_meta` Claude Code reads as "never defer" — any transport, OR'd with the server
 * entry's `alwaysLoad` (bundled CLI 0.3.220: `alwaysLoad: config.alwaysLoad || _meta["anthropic/alwaysLoad"]`).
 */
export declare const ALWAYS_LOAD_META: {
    readonly "anthropic/alwaysLoad": true;
};
export declare const GRANULAR_TOOLS: readonly GranularTool[];
/** A binding key split into the legacy tool and its gate key (`op` or `op.action`). */
export declare function parseBinding(key: BindingKey): {
    tool: string;
    op: string | undefined;
};
export declare function bindingsOf(t: GranularTool): BindingKey[];
/** Read-only iff no bound key is a gated write. */
export declare function isReadOnlyTool(t: GranularTool): boolean;
/** A binding the delete policy refuses — must be false for every tool. */
export declare function bindsDeleteOp(t: GranularTool): boolean;
/** `container` is published iff some bound op still honours it (`workspace-arg.ts`). */
export declare function takesContainer(t: GranularTool): boolean;
/** Every hint explicit: the MCP defaults (destructive, open-world) are wrong for a write here. */
export declare function annotationsFor(t: GranularTool): ToolAnnotations;
