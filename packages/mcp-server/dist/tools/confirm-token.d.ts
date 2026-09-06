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
 * ⚠ **ONE THING DID BECOME A FENCE, AND ONLY ONE (G16, A11).** A SPENT token
 * now yields `acknowledgedShared: true`, which the caller puts on the write body
 * as `acknowledgeShared` — and `src/features/workspaces/server/
 * shared-publish.ts` answers **400 `CONTAINER_PUBLISH_UNACKNOWLEDGED`** to a
 * publish into a shared `kind='link'` container that arrives without it. That
 * refusal is the SERVER'S, so skipping this module does not skip it. It still
 * does not mean a human approved anything — an agent can set the flag by
 * previewing and confirming alone — so every sentence above stands. What
 * changed is only that the act can no longer happen with NOTHING said about the
 * audience, anywhere in the stack.
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
/**
 * ⚠ `acknowledgedShared` IS THE SERVER'S PRECONDITION, CARRIED OUT OF HERE
 * (G16, A11). The write body sends it as `acknowledgeShared: true`, and
 * `src/features/workspaces/server/shared-publish.ts` 400s
 * `CONTAINER_PUBLISH_UNACKNOWLEDGED` without it — so the token stops being a
 * pure tripwire on this one axis: an agent that skips the preview does not
 * skip the refusal, because the refusal is the server's.
 *
 * ⚠ IT IS TRUE ONLY WHEN A TOKEN WAS ACTUALLY SPENT ON THIS ACT. The two
 * "nothing to confirm" proceeds — not publishing, and publishing into a room
 * with nobody else in it — carry FALSE, because nobody was shown anything.
 * Setting it there would make the flag mean "the client felt like it", which is
 * the client-side confirm this slice exists to replace.
 */
export type ConfirmVerdict = {
    kind: "proceed";
    acknowledgedShared: boolean;
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
 * 🔒 **THE SERVER'S OWN REFUSAL, MADE LEGIBLE — 400
 * `CONTAINER_PUBLISH_UNACKNOWLEDGED`** (G16;
 * `src/features/workspaces/server/shared-publish.ts`).
 *
 * ⚠ DUCK-TYPED ON THE STATUS AND THE CODE, never on an error class: no server
 * error type crosses this package boundary, which is the shape
 * `shelf.ts › homeShelfForbidden` established and `knowledge-ops-write.ts ›
 * agentCreateForbidden` repeated.
 *
 * ⚠ **THE REMEDY IS THE CALLER'S TO SUPPLY, BECAUSE IT DIFFERS BY OP.** On a
 * previewed op this refusal can only be a RACE — the room gained a member
 * between the preview and the act — and the fix is a fresh preview. On an op
 * with no preview step it is the ordinary answer, and the fix is a human. One
 * message for both would be wrong for both.
 */
export declare function containerPublishUnacknowledged(e: unknown, remedy: string): ToolResponse | null;
/** The remedy for an op that HAS a preview step: this refusal means the room
 *  changed under the token, so the answer is to look again. */
export declare const RECONFIRM_REMEDY = "Re-issue the SAME call WITHOUT `confirm_token` to get a fresh preview of who would see it, then confirm THAT one.";
/**
 * THE GATE. Call it after the local contradiction refusals and before the
 * client write.
 *
 *   - not publishing, no token   → proceed
 *   - not publishing, with token → refuse (stray token)
 *   - publishing, not a shared container → proceed (nobody else is in the room)
 *   - publishing into a shared container, no token → PRECHECK, then PREVIEW + a
 *     fresh token — or the precheck's refusal, and NO token
 *   - publishing into a shared container, token    → verify, then proceed
 *     WITH `acknowledgedShared: true` — which the caller must put on the write
 *     body as `acknowledgeShared`, or the server refuses it (G16).
 *
 * 🔒 **`precheck` — A PREVIEW MUST NEVER ISSUE A TOKEN FOR AN ACT THE CONFIRMED
 * CALL WOULD REFUSE** (task 11, the pin the create side shipped without).
 *
 * ⚠ **THE HOLE IT CLOSES WAS LIVE AND WAS OBSERVED.** `dopl_kb
 * op="create_base" visibility="public"` in a shared home channel previewed,
 * handed back a `confirm_token`, and the echoed call was then refused by the
 * server's create gate. Everything in this module is decided from what THIS
 * process can see — the room's kind and its member count — and the gates that
 * actually refuse live in the server, so the preview was confidently describing
 * an act that could not happen. A token for an impossible act is worse than no
 * preview: the caller reads "re-issue with this token" as permission.
 *
 * ⚠ **IT IS THE CALLER'S CALLBACK BECAUSE THE GATE IS THE CALLER'S**, and this
 * module must not learn what a knowledge base is. `knowledge-ops-write.ts`
 * passes one that asks the SERVER to run the create's own gate chain with the
 * body the confirmed call will send (`dryRunKbBase`), so parity is the server's
 * one function rather than a rule two processes both promise to keep.
 *
 * ⚠ **IT RUNS ONLY WHERE A TOKEN WOULD BE MINTED.** Not on the private arm, not
 * in a standard workspace, and not on the confirm echo — where the real call
 * runs the real gate a moment later and refuses honestly on its own. So an
 * ordinary create pays nothing for it.
 *
 * ⚠ **IT REFUSES, IT NEVER PROCEEDS.** Returning a response halts; returning
 * `null` means "no objection", which is the only thing a precheck may say in
 * the permissive direction. It cannot mint, cannot spend and cannot widen the
 * class — an act that is not audience-changing never reaches it.
 */
export declare function confirmGate(client: DoplClient, act: ConfirmAct, opts: {
    publishes: boolean;
    token?: string;
    /** Asked once, immediately before a token is minted. A response HALTS with
     *  it; `null` proceeds to the preview. ⚠ It may THROW, and a throw is not
     *  swallowed here: "I could not tell whether this would be refused" must
     *  never resolve into a minted token. */
    precheck?: () => Promise<ToolResponse | null>;
}): Promise<ConfirmVerdict>;
/** ⚠ TEST-ONLY. Nothing in the server calls it; the store is process-lifetime
 *  state and a suite that cannot clear it tests the previous suite's leftovers. */
export declare function __resetConfirmTokensForTest(): void;
