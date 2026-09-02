/**
 * gating.ts — THE GATES, and the tables they read.
 *
 * ⚠ THE TOPOLOGY IS THE INVARIANT. Gates run at REGISTRATION (the tool never
 * exists) or per CALL (the op is refused):
 *
 *   registration → {@link Gates.isSuppressedTool}: HIDDEN_TOOLS, plus the
 *                  role-scoped offer a `X-Dopl-Tool-Profile` header asks for.
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
 * ⚠ `READ_ONLY_BLOCKED_TOOLS` WAS DELETED WITH THE FIVE `_admin` TOOLS
 * (2026-09-02). It held exactly those five names — the purely destructive tools
 * a read-only session was not even offered — and nothing can join it: deletion
 * is app-only, so no destructive tool can be registered for it to name. A
 * read-only session's write refusal is {@link WRITE_OPS}, per op, which is where
 * it always was for every mixed tool.
 *
 * ⚠ `parity.test.ts` / `delete-block.test.ts` PARSE `WRITE_OPS` and
 * `HIDDEN_TOOLS` out of this file's SOURCE TEXT (`tools/parity-harness.ts`).
 * The parse follows the constant, not the filename.
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
/**
 * ROLE-SCOPED TOOL OFFERS — which tools a session in a given role is offered.
 * The `X-Dopl-Tool-Profile` request header names the role; this table decides
 * what it means. EMPTY TODAY: the mechanism ships in wave A and the table is
 * filled in wave B, so every role currently serves the whole surface.
 *
 * ⚠ NARROWING-ONLY BY CONSTRUCTION, in three ways that must all stay true:
 *   1. a role's value is an ALLOW set INTERSECTED with what the registrars
 *      register, so a role can never name a tool into existence;
 *   2. an ABSENT header, and a role with no row here, both resolve to `null` =
 *      no narrowing = the whole surface. An unknown role can therefore never
 *      widen anything, and a desktop build newer than this server degrades to
 *      today's behaviour rather than to an empty tool list;
 *   3. it is a HINT AND NOT A FENCE. The header is caller-supplied, so anything
 *      holding the credential can pick any role — including none. Containment
 *      is the desktop's `disallowedTools` + `grantDecision`, and the credential
 *      itself. Nothing may be GRANTED on this value. Same discipline as
 *      `src/shared/auth/runtime-header.ts`.
 */
export declare const TOOL_PROFILE_TOOLS: Record<string, ReadonlySet<string>>;
/**
 * The tools a role is offered, or `null` for "no narrowing". ⚠ The ONE place a
 * profile name becomes a set, so the fail-open direction is written once.
 */
export declare function offeredToolsFor(toolProfile: string | null | undefined): ReadonlySet<string> | null;
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
     * `HIDDEN_TOOLS` plus anything outside this session's role-scoped offer. The
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
 * FAILS CLOSED upstream — write only on an explicit `dopl.write`.
 *
 * ⚠ `offeredTools` is the RESOLVED set, not a role name, so a caller can hand in
 * any set it likes — which is what lets `meta-gate.test.ts` drive the
 * suppression leg with synthetic names instead of against a table that is empty
 * by design. `server.ts` resolves it through {@link offeredToolsFor}; `null` is
 * "serve everything" and is the only behaviour wave A ships.
 */
export declare function createGates(canWrite: boolean, offeredTools?: ReadonlySet<string> | null): Gates;
