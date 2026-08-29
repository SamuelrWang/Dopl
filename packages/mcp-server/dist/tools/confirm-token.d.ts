/**
 * confirm-token.ts — THE CONFIRM CLASS: a dry-run PREVIEW plus an opaque,
 * server-minted token that the acting call must echo back (Samuel's ruling Q10
 * (ii), 2026-08-28; spec `docs/specs/mcp-surface-v2.plan.md` §7.3).
 *
 * 🔒 ⚠ **A CONFIRM TOKEN IS A TRIPWIRE, NOT A FENCE.** Nothing here stops an
 * agent calling the preview and echoing the token back without ever showing a
 * human. What actually REFUSES the human-reaching acts is the `sessionOnly`
 * set, the `source === "agent"` refusals, B1 (the credential lock) and layer A
 * (the audience ceiling in `src/features/knowledge/server/service-audience.ts`).
 * The token buys that the agent SAW what it was about to do — which is worth
 * having, and is not the same as a person having approved it. Do not describe
 * this module as containment, and do not let a caller's copy imply it.
 *
 * ⚠ SCOPED TO THE AUDIENCE-CHANGING WRITE CLASS AND NOTHING ELSE. A confirm on
 * every write trains the agent to skip it — the identical argument INVARIANTS
 * §10 makes for untrusted-content headers ("a header on every result trains
 * agents to skip headers"). Today the class is exactly: a template or a
 * knowledge base landing at an audience BEYOND THE CALLER inside a SHARED link
 * container, i.e. the room a peer is standing in.
 *
 * ── THE STORE, AND WHY ITS FAILURE MODE IS THE RIGHT ONE ───────────────────
 * ⚠ THE MCP SERVER BOOTS ONCE PER HTTP REQUEST (`factory.ts › bootServer`), so
 * the store is MODULE-scoped, not session-scoped — it lives as long as the Node
 * process. A token minted in one process is UNKNOWN in another, and an unknown
 * token REFUSES: the failure mode of a lost store is "preview again", never
 * "the write goes through". That is the only direction this may ever fail.
 */
import type { DoplClient } from "@dopl/client";
import { type ToolResponse } from "./respond.js";
/**
 * What the confirm gate needs to know about the workspace a call resolved to.
 *
 * ⚠ `unknown` FAILS CLOSED — it is treated as a shared container. Reading "I
 * could not tell how many people are in this room" as "nobody" is the inversion
 * `factory.ts › bootServer`'s `?? 0` exists to refuse, and this module inherits
 * that rule rather than restating a softer one.
 */
export interface ConfirmTarget {
    workspaceId: string | null;
    /** Neutralized display name, or a fallback — this is a VALUE. */
    label: string;
    /** A `kind='link'` container with more than one active member. */
    sharedContainer: boolean;
    unknown: boolean;
}
/**
 * Resolve the workspace this call actually landed in.
 *
 * ⚠ READS THE ALS OVERRIDE FIRST. `registrar.ts` runs the handler inside
 * `workspaceContext.run(resolvedId, …)` for a per-call `workspace=`, and the
 * transport's stored id is the SESSION default — reading only the latter would
 * ask "is my default workspace a container" about a call that went elsewhere.
 *
 * ⚠ ONE loopback, on a COLD path: it runs only for a write that is already
 * asking to publish. Nothing on the hot read paths pays for it.
 */
export declare function resolveConfirmTarget(client: DoplClient): Promise<ConfirmTarget>;
/** One audience-changing act, as the gate needs to see it. */
export interface ConfirmAct {
    tool: string;
    op: string;
    callerUserId: string | null;
    /** One line naming what will exist afterwards. Values must be neutralized. */
    what: string;
    /** Who will be able to see it. Values must be neutralized. */
    audience: string;
    /** ⚠ EVERY field that decides what lands and who sees it. A field left out
     *  is a field the agent can change between the preview and the act. */
    payload: Record<string, unknown>;
}
export type ConfirmVerdict = {
    kind: "proceed";
} | {
    kind: "halt";
    response: ToolResponse;
};
/**
 * ⚠ A TOKEN ON A CALL THAT IS NOT IN THE CONFIRM CLASS IS REFUSED, not ignored.
 * The house rule is that an unknown argument is refused rather than stripped
 * (`registrar.ts › strictInput`), and the same reasoning applies one level up: a
 * caller echoing a token into a private create has mis-modelled the surface, and
 * silently accepting it teaches the wrong shape.
 */
export declare function refuseStrayToken(tool: string, op: string): ToolResponse;
/**
 * THE GATE. Call it after the local contradiction refusals and before the
 * client write.
 *
 *   - not publishing, no token   → proceed
 *   - not publishing, with token → refuse (stray token)
 *   - publishing, not a shared container → proceed (nobody else is in the room)
 *   - publishing into a shared container, no token → PREVIEW + a fresh token
 *   - publishing into a shared container, token    → verify, then proceed
 */
export declare function confirmGate(client: DoplClient, act: ConfirmAct, opts: {
    publishes: boolean;
    token?: string;
}): Promise<ConfirmVerdict>;
/** ⚠ TEST-ONLY. Nothing in the server calls it; the store is process-lifetime
 *  state and a suite that cannot clear it tests the previous suite's leftovers. */
export declare function __resetConfirmTokensForTest(): void;
