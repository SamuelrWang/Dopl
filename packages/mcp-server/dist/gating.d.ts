/**
 * gating.ts — THE FOUR GATES, and the three tables they read.
 *
 * ⚠ THE TOPOLOGY IS THE INVARIANT. TWO gates run at REGISTRATION (the tool
 * never exists) and TWO per CALL (the op is refused):
 *
 *   registration → {@link Gates.isSuppressedTool}: HIDDEN_TOOLS and, for a
 *                  read-only session, READ_ONLY_BLOCKED_TOOLS.
 *   per call     → {@link Gates.opRefusal}: the app-only-deletion block FIRST
 *                  and unconditionally, then the write-scope gate.
 *
 * ⚠ They live HERE, outside the registration wrapper, because
 * `registerMetaTool` registers straight onto the SDK server — inline gating
 * published two tools that passed through none of them. Do NOT push these back
 * inside a wrapper; both registration helpers call them explicitly.
 *
 * ⚠ ORDERING INSIDE `opRefusal` IS LOAD-BEARING: the delete refusal fires
 * first and unconditionally, before workspace resolution and any client call,
 * so a refused delete costs zero round trips and can never half-happen. It must
 * never become reachable only after another gate lets the call through.
 *
 * ⚠ `parity.test.ts` / `delete-block.test.ts` PARSE `WRITE_OPS`,
 * `READ_ONLY_BLOCKED_TOOLS` and `HIDDEN_TOOLS` out of this file's SOURCE TEXT
 * (`tools/parity-harness.ts`). The parse follows the constant, not the filename.
 */
import type { ToolResponse } from "./tools/respond.js";
/**
 * THE HIDE-BEFORE-DELETE SEAM — a registered tool an agent no longer sees.
 * Empty is the current state, not a dead mechanism: retirement is two steps
 * (hide, then delete), and this is step one's whole implementation.
 *
 * ⚠ A tool that no longer EXISTS must not be listed here —
 * `delete-block.test.ts` asserts every HIDDEN name still has a registrar, and a
 * name with none is a claim about a gate that guards nothing.
 *
 * ⚠ At the REGISTRAR, not the route: the MCP server reaches the app's routes
 * over LOOPBACK HTTP through `DoplClient`, so gating a route 500s the tool while
 * the agent still SEES it in `tools/list`. Unregistered = absent = nothing to
 * call. Same choke point as `READ_ONLY_BLOCKED_TOOLS` below.
 */
export declare const HIDDEN_TOOLS: Set<string>;
/** Purely destructive tools aren't even registered for a read-only session. */
export declare const READ_ONLY_BLOCKED_TOOLS: Set<string>;
/**
 * Per-op write gating for MIXED read+write tools — they stay registered for
 * read-only sessions so reads work, but write ops are refused. ⚠ Keep each set
 * in sync with the tool's `op` enum: a new write op MUST be added here, or a
 * `dopl.read`-only token can write through a non-admin tool.
 */
export declare const WRITE_OPS: Record<string, Set<string>>;
/** The four gates, bound to one session's write capability. */
export interface Gates {
    /**
     * Suppressed at registration: absent from `tools/list`, nothing to call —
     * `HIDDEN_TOOLS` plus, for a read-only session, the destructive tools. The
     * honest way to remove a capability is for the tool not to exist.
     */
    isSuppressedTool(name: string): boolean;
    /** The `op` a call is asking for, or undefined for an op-less tool. */
    requestedOp(args: unknown): string | undefined;
    /**
     * ⚠ Per-call refusals in the order they must fire: app-only deletion
     * (unconditional — never reachable only after another gate lets the call
     * through), then the read-only write-scope gate. Null = proceed. Refusing
     * here means no workspace resolved and no backend request made.
     */
    opRefusal(name: string, op: string | undefined): ToolResponse | null;
}
/**
 * Build the gates for one session. ⚠ `canWrite` is the OAuth scope verdict and
 * FAILS CLOSED upstream — write/admin only on an explicit `dopl.write`.
 */
export declare function createGates(canWrite: boolean): Gates;
