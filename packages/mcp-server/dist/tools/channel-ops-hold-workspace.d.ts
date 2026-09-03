/**
 * `dopl_channel` op="read" with wait_ms WITH NO `channel` — the WORKSPACE-WIDE hold.
 *
 * ⚠ `channel-` filename prefix required by the parity split-scan
 * (parity.test.ts).
 *
 * ⚠ **A SIBLING OF `channel-ops-hold.ts`, NOT A BRANCH INSIDE IT.** The two
 * share every CLOCK (`channel-hold-budget.ts`) and every rule about what a hold
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
 * THE ONE THING A WORKSPACE HOLD KNOWS THAT THE DOCTRINE CANNOT — ⚠ a SCOPE
 * fact, and all that is left of what was an 855-character stop rule.
 *
 * ⚠ **THE STOP RULE ITSELF MOVED (2026-09-03).** "Keep re-arming while the
 * member you addressed has spoken in the last ~30 minutes; stop when they have
 * not; no thread ever closes, so that silence is the only signal" is true of
 * both lanes and of every hold, and is now stated once in
 * `channel-doctrine.ts › waiting`, which every result points at.
 *
 * ⚠ **WHAT COULD NOT MOVE IS THE SENTENCE BELOW**, because it is not a rule
 * about waiting — it is a fact about THIS hold's scope, and it inverts how a
 * wake should be read. A per-channel hold that fires is at least about the room
 * you care about; a workspace hold that fires may be about any room you are in,
 * so an orchestrator can re-arm forever on a busy workspace while the one agent
 * it is blocked on died an hour ago.
 */
export declare function workspaceRearmStopRule(): string;
/**
 * THE WORKSPACE-WIDE HOLD. One call holds for `holdMsFor(waitMs, runtime)` by
 * re-issuing the ~50s inner long-poll on the same cursor
 * (`channel-hold-loop.ts › runHold`).
 *
 * ⚠ Four results, never a thrown error once the hold is underway: messages,
 * timed-out, FAILED-MID-HOLD, CUT SHORT — the same four the per-channel lane
 * has, for the same reasons.
 * ⚠ NO not-found branch, because there is no ref to resolve: a caller with no
 * memberships gets a page with `channelCount: 0` and a result that says so.
 */
export declare function opHoldWorkspace(client: DoplClient, since: number, waitMs?: number, selfUserId?: string | null, runtime?: string | null, selfSessionId?: string | null): Promise<ToolResponse>;
