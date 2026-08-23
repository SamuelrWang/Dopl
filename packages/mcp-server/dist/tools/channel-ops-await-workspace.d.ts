/**
 * `dopl_channel` op="await" WITH NO `channel` — the WORKSPACE-WIDE hold.
 *
 * ⚠ `channel-` filename prefix required by the parity split-scan
 * (parity.test.ts).
 *
 * ⚠ **A SIBLING OF `channel-ops-await.ts`, NOT A BRANCH INSIDE IT.** The two
 * share every CLOCK (`channel-await-budget.ts`) and every rule about what a hold
 * may CLAIM (`channel-wake-guidance.ts`), and they deliberately do not share a
 * function: the per-channel op's whole result vocabulary is written around ONE
 * named channel — its re-arm call, its not-found, its stop rule all splice
 * `ref` — and threading an `undefined` ref through that would produce sentences
 * with a hole in them at exactly the moment an agent is deciding what to do next.
 *
 * ⚠ **ONE CURSOR IS LEGAL HERE BECAUSE `seq` IS WORKSPACE-GLOBAL AND GAPPY** —
 * the same property that makes a per-channel seq RANGE meaningless as a message
 * count. Ordering by it interleaves channels in true arrival order, so advancing
 * to the highest seq on a page means everything below it has been seen in EVERY
 * channel on the page.
 *
 * ⚠ **IT WATCHES CHANNELS THE CALLER IS A MEMBER OF, AND SAYS SO.** A PUBLIC
 * channel they never joined is NOT watched — narrower than `op="read"`, on
 * purpose (the argument is in
 * `src/features/channels/server/repository-await-workspace.ts ›
 * listMemberChannelRefs`). The result states the scope rather than leaving an
 * agent to infer it from an absence, because "no messages" and "that room was
 * never being watched" are different facts and only one of them is a reason to
 * keep waiting.
 */
import type { DoplClient } from "@dopl/client";
import { type ToolResponse } from "./respond";
/**
 * The re-arm stop rule for a WORKSPACE hold.
 *
 * ⚠ **IT IS DELIBERATELY DIFFERENT FROM THE PER-CHANNEL ONE, AND THE DIFFERENCE
 * IS THE WHOLE POINT.** `channel-ops-await.ts › rearmStopRule` says to judge
 * liveness ONLY on the member you addressed, because in a busy channel other
 * members' traffic is not evidence your exchange is alive. A workspace hold
 * makes that trap strictly worse — EVERY channel's traffic now wakes you — so
 * the rule has to be restated here rather than reused, and it has to name the
 * new failure: an orchestrator re-arming forever because the workspace is busy
 * while the one agent it is waiting on died an hour ago.
 * ⚠ It also states the ABSENCE of a finished state, for the same reason every
 * other stop rule does (INVARIANTS §10): an agent trained on a surface that had
 * one waits for it forever.
 */
export declare function workspaceRearmStopRule(): string;
/**
 * LONG-HOLD workspace await. One call holds up to `timeoutMs` (capped at
 * {@link AWAIT_HOLD_MS}) by re-issuing the ~50s inner long-poll on the same
 * `since` cursor.
 *
 * ⚠ Four results, never a thrown error once the hold is underway: messages,
 * timed-out, FAILED-MID-HOLD, CUT SHORT — the same four the per-channel op has,
 * for the same reasons.
 * ⚠ NO not-found branch, because there is no ref to resolve: a caller with no
 * memberships gets a page with `channelCount: 0` and a result that says so.
 */
export declare function opAwaitWorkspace(client: DoplClient, since: number, timeoutMs?: number, selfUserId?: string | null): Promise<ToolResponse>;
