/**
 * The gates and their tables. Both registration helpers call them explicitly: `registerMetaTool`
 * bypasses `registerTool`'s wrapper, so never fold them into one. `tools/parity-harness.ts` parses
 * this source text; `tool-profile.test.ts` bans its PERSONA_WORDS here, comments included.
 */
import type { ToolResponse } from "./tools/respond.js";
export declare const HIDDEN_TOOLS: Set<string>;
/**
 * Containment profiles `X-Dopl-Tool-Profile` may name (`tool-profiles.js › KNOWN_PROFILES`),
 * narrowest first. A profile says how much of the machine a session may touch, never what it is for.
 */
export declare const TOOL_PROFILES: readonly ["read_only", "dopl_only", "channel_agent", "full"];
export type ToolProfile = (typeof TOOL_PROFILES)[number];
export declare const NARROWEST_TOOL_PROFILE: ToolProfile;
/**
 * The tools this session is offered, or `null` for no narrowing. Tested on the type: `""` is a
 * profile claim (`tool-profile-header.ts › UNREADABLE_TOOL_PROFILE`), never the full surface.
 */
export declare function offeredToolsFor(claimed: string | null | undefined): ReadonlySet<string> | null;
/**
 * Per-op write gating for mixed read+write tools; a new write op must be added here or a
 * `dopl.read` token can write through it. Inside these `new Set([ … ])` blocks only op names may be
 * double-quoted, comments included: `tools/parity-harness.ts` and the desktop's
 * `knowledge-read-ops.test.mjs` parse the source text and read every quoted word as an op.
 */
export declare const WRITE_OPS: Record<string, Set<string>>;
/**
 * Does `op` ({@link Gates.requestedOp}'s key) write? A bare entry gates every action of its op, a
 * dotted one (`rooms.open`) one action; a bare call to an op with dotted write entries fails closed.
 */
export declare function isWriteOp(name: string, op: string): boolean;
/** One session's gates, bound to its write capability and profile offer. */
export interface Gates {
    /** Absent from `tools/list`: hidden, or outside the profile offer. */
    isSuppressedTool(name: string): boolean;
    requestedOp(args: unknown): string | undefined;
    /** App-only deletion (first, unconditional), then write scope; null = proceed. Before any I/O. */
    opRefusal(name: string, op: string | undefined): ToolResponse | null;
}
/** `canWrite` fails closed upstream (explicit `dopl.write` only); `offeredTools` is resolved. */
export declare function createGates(canWrite: boolean, offeredTools?: ReadonlySet<string> | null): Gates;
