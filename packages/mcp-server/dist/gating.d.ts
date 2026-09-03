/**
 * gating.ts — THE GATES, and the tables they read.
 *
 * ⚠ THE TOPOLOGY IS THE INVARIANT. Gates run at REGISTRATION (the tool never
 * exists) or per CALL (the op is refused):
 *
 *   registration → {@link Gates.isSuppressedTool}: HIDDEN_TOOLS, plus the
 *                  profile-scoped offer `X-Dopl-Tool-Profile` reports.
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
 * THE SESSION PROFILES THE HEADER MAY NAME — the four CONTAINMENT profiles the
 * desktop already spawns sessions under (`dopl-desktop-app/main/tool-profiles.js
 * › KNOWN_PROFILES`), carried on the wire by `X-Dopl-Tool-Profile`.
 *
 * ⚠ A PROFILE SAYS HOW MUCH OF THE MACHINE A SESSION MAY TOUCH, AND NOTHING
 * ABOUT WHAT IT IS FOR. There is no table here keyed on what one operator's
 * sessions do for each other: one account runs many sessions that direct each
 * other, another runs a single one, and neither arrangement is a product
 * concept every connection should pay to be told about.
 * `tool-profile.test.ts` pins this list as a VALUE and scans the served text,
 * so a name of that kind cannot enter the surface through this file.
 *
 * ⚠ ORDERED NARROWEST FIRST. The head is {@link NARROWEST_TOOL_PROFILE}, the
 * answer for every value this server cannot place.
 */
export declare const TOOL_PROFILES: readonly ["read_only", "dopl_only", "channel_agent", "full"];
/** One of {@link TOOL_PROFILES} — the whole vocabulary, and nothing else. */
export type ToolProfile = (typeof TOOL_PROFILES)[number];
/**
 * THE FLOOR, AND THE ANSWER TO EVERY UNRECOGNIZED CLAIM — an unknown name, a
 * near-miss, or a header carrying two different values
 * (`src/shared/auth/tool-profile-header.ts`).
 *
 * ⚠ FAIL CLOSED, matching the desktop's own `normalizeProfile`: the header
 * carries the profile a session is ALREADY contained at, so a value this server
 * cannot place describes a containment it does not know, and the only offer that
 * cannot be wider than the truth is the narrowest one.
 *
 * ⚠ AN ABSENT HEADER IS NOT AN UNRECOGNIZED ONE. No claim is no narrowing —
 * which is what keeps every client that sends nothing (the OAuth connector, the
 * stdio binary, an older desktop) on the whole surface.
 */
export declare const NARROWEST_TOOL_PROFILE: ToolProfile;
/**
 * The tools this session is offered, or `null` for "no narrowing". ⚠ THE ONE
 * PLACE A PROFILE BECOMES A SET, so both directions are written once:
 * `undefined`/`null` is NO CLAIM and serves everything, while ANY string is a
 * claim — narrowed to its row, or to the narrowest profile's row when this
 * server cannot place it. ⚠ The absence test is on the TYPE, not on
 * truthiness: `""` is a claim this server could not read
 * (`tool-profile-header.ts › UNREADABLE_TOOL_PROFILE`), and falling through a
 * `!claimed` check would serve it the whole surface — the one direction this
 * value may never fail.
 */
export declare function offeredToolsFor(claimed: string | null | undefined): ReadonlySet<string> | null;
/**
 * Per-op write gating for MIXED read+write tools — they stay registered for
 * read-only sessions so reads work, but write ops are refused. ⚠ Keep each set
 * in sync with the tool's `op` enum: a new write op MUST be added here, or a
 * `dopl.read`-only token can write through a non-admin tool.
 */
export declare const WRITE_OPS: Record<string, Set<string>>;
/**
 * Does `op` — the key {@link Gates.requestedOp} produced — write?
 *
 * ⚠ **TWO GRAINS, ON PURPOSE.** A bare entry (`manage`) gates the whole op; a
 * dotted one (`rooms.open`) gates one action and leaves its siblings readable.
 * `rooms` needs the fine grain — four of its actions read — and `manage` needs
 * the coarse one, because listing five actions that all write is five chances to
 * add a sixth and forget.
 *
 * ⚠ **THE BARE-CALL ARM FAILS CLOSED, AND THAT IS THE WHOLE REASON THIS IS A
 * FUNCTION.** A sub-actioned call arrives as `rooms.open`; a call that named NO
 * action arrives as bare `rooms`, and it must not read as "no matching write
 * entry, therefore a read". The handler refuses a missing `action` before any
 * write happens, so nothing is lost by refusing it here too — and refusing it
 * here is what keeps the gate's answer independent of a handler's discipline.
 *
 * ⚠ The scan is over ONE tool's set, at most a dozen short strings, on a path
 * that already does a `Set.has`. It is not worth an index.
 */
export declare function isWriteOp(name: string, op: string): boolean;
/** The four gates, bound to one session's write capability. */
export interface Gates {
    /**
     * Suppressed at registration: absent from `tools/list`, nothing to call —
     * `HIDDEN_TOOLS` plus anything outside this session's profile offer. The
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
 * ⚠ `offeredTools` is the RESOLVED set, not a profile name, so a caller can hand
 * in any set it likes — which is what lets `meta-gate.test.ts` drive the
 * suppression leg with synthetic names rather than through the real table.
 * `server.ts` resolves it through {@link offeredToolsFor}; `null` is "serve
 * everything", which is what a connection claiming no profile gets.
 */
export declare function createGates(canWrite: boolean, offeredTools?: ReadonlySet<string> | null): Gates;
