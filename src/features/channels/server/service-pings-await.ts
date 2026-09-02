import "server-only";
import type { ChannelPing } from "../types-ping";
import {
  AWAIT_POLL_INTERVAL_MS,
  AWAIT_REVALIDATE_EVERY_TICKS,
  MAX_PING_LIMIT,
} from "../constants";
import {
  listMemberChannelRefs,
  type MemberChannelRef,
} from "./repository-await-workspace";
import { hasPingForRecipient } from "./repository-pings";
import { listPings } from "./service-pings";
import type { ChannelContext } from "./service-shared";

/**
 * THE PING HOLD — `GET /api/pings/await?since=`: block until a ping addressed to
 * THIS caller lands, or the deadline passes (2026-09-01,
 * `docs/specs/needs-you-ping.md`).
 *
 * ⚠ **A SIBLING OF `service-await.ts` AND `service-await-workspace.ts`, NEVER A
 * GENERALIZATION OF EITHER.** Those two already state, in bold, why they are
 * forked rather than folded into one signature: a "channel or workspace mode"
 * behind one function puts two authorization stories behind one fence. This is a
 * THIRD fence — `recipient_user_id = ctx.userId` — and a third arm on that
 * signature would be the same mistake a third time. What IS shared is the tick
 * interval and the SHAPE of the options, deliberately restated rather than
 * unified, so a change to one is a visible decision about the others.
 *
 * ── WHY THIS LOOP RE-PROVES, ON THE SAME CADENCE AS ITS TWO SIBLINGS ────────
 * ⚠ **CORRECTED 2026-09-02 (R1).** This docblock used to argue that the fence
 * "IS the SQL predicate" and that a ping about a channel the caller had SINCE
 * LEFT still reaching them was the designed answer. It was not: the RLS policy
 * `channel_pings_party_select` is `is_channel_member(channel_id) AND (party)`,
 * and this lane runs on the admin client — so the two lanes disagreed for
 * exactly the caller a removal is about. The fence is therefore a FACT ABOUT THE
 * CALLER that can stop being true mid-hold, which is precisely why the other two
 * holds carry `AWAIT_REVALIDATE_EVERY_TICKS`, and this one now does too.
 *
 * ⚠ **NO ROW FETCH MAY PRECEDE A PROOF**, which is `service-await-workspace.ts`'s
 * ordering rule restated: the proof narrows the very query that follows it, and a
 * proof that did not narrow the next query is a proof of nothing.
 *
 * ⚠ **A PING HAS NO `channel_messages.seq`, SO THIS HOLD AND A CHANNEL `await`
 * CANNOT INTERFERE.** `since` here is a PING cursor; the two spaces are separate
 * by construction and a caller that crosses them reads a plausible, wrong page
 * rather than an error.
 */

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Query counters for one ping hold. ⚠ Mutated in place, so a hold that ends in a
 * THROW still leaves its counts with the caller — the route logs them from a
 * `finally`, and counts living only in the return value lose exactly the holds
 * worth watching.
 */
export interface PingAwaitCounters {
  /** Ping queries issued — existence probes plus row reads. */
  polls: number;
  /** Membership re-proofs issued. ⚠ Added 2026-09-02 with the fence itself
   *  (R1); `WorkspaceAwaitCounters` carries the identical field for the
   *  identical reason. */
  revalidations: number;
}

export interface PingAwaitOptions {
  /** Cursor: only pings with `seq > since` end the hold. */
  since: number | undefined;
  /** Absolute epoch-ms deadline; the hold returns empty once it passes. */
  deadline: number;
  /** Aborts the hold when the client disconnects. */
  signal?: { aborted: boolean };
  /** Tick interval. ⚠ Overridable so tests never sleep in real seconds — the
   *  identical knob and the identical reason as `AwaitHoldOptions`. */
  pollIntervalMs?: number;
  /** ⚠ Counters the CALLER owns, so they survive a throw. */
  counters?: PingAwaitCounters;
}

export interface PingAwaitResult {
  pings: ChannelPing[];
}

/**
 * Hold until a ping addressed to `ctx.userId`, in a channel they are still a
 * member of, exists past `since` — or until `deadline`.
 *
 * ⚠ THE FIRST READ IS IMMEDIATE AND IS A ROW READ, not a probe — the desktop's
 * wake path arms this with a near-zero timeout, so probing first would add a
 * round trip and save nothing. Every tick AFTER that opens with the one-column
 * existence probe, because a hold armed continuously is the structurally growing
 * egress consumer the tick shape exists to bound.
 */
export async function awaitPings(
  ctx: ChannelContext,
  opts: PingAwaitOptions
): Promise<PingAwaitResult> {
  const { since, deadline, signal } = opts;
  const intervalMs = opts.pollIntervalMs ?? AWAIT_POLL_INTERVAL_MS;
  const counters: PingAwaitCounters = opts.counters ?? {
    polls: 0,
    revalidations: 0,
  };

  let ticks = 0;
  let verifiedAtTick = -1;
  let refs: MemberChannelRef[] = [];

  /** ⚠ It REPLACES `refs`; see the module docblock's ordering rule. */
  const proveAccess = async () => {
    refs = await listMemberChannelRefs(ctx.workspaceId, ctx.userId);
    verifiedAtTick = ticks;
    counters.revalidations += 1;
  };
  const proveAccessUnlessProvenThisTick = async () => {
    if (verifiedAtTick === ticks) return;
    await proveAccess();
  };

  // ⚠ TICK 0's PROOF, BEFORE ANY ROW IS FETCHED. Nothing upstream has proven
  // channel membership for this caller — the route only resolved the workspace.
  await proveAccess();

  // ⚠ THE PAGE CEILING IS THE INBOX'S OWN, not a bespoke number: the read is
  // ASCENDING by `seq`, so a burst clipped by the cap is RESUMED by the caller's
  // next `since` rather than skipped.
  const read = () => listPings(ctx, { since, limit: MAX_PING_LIMIT }, refs);
  const ids = () => refs.map((r) => r.id);

  counters.polls += 1;
  let pings = await read();

  while (pings.length === 0 && Date.now() < deadline && !signal?.aborted) {
    await sleep(Math.min(intervalMs, Math.max(0, deadline - Date.now())));
    ticks += 1;
    // Background recheck: first held tick, then every Nth — the same cadence and
    // the same ~15s bounded staleness both sibling holds run.
    if ((ticks - 1) % AWAIT_REVALIDATE_EVERY_TICKS === 0) {
      await proveAccessUnlessProvenThisTick();
    }
    counters.polls += 1;
    // ⚠ The probe carries the SAME predicates as the row read — the proven
    // channel set included (`repository-pings.ts › hasPingForRecipient` states
    // the rule): a probe that hits on a row the read then drops spins the hold
    // fetch-empty-continue, one extra pair of queries every tick, forever, since
    // the caller's cursor never advances past a row it is never handed.
    if (!(await hasPingForRecipient(ctx.userId, ctx.workspaceId, ids(), since))) {
      continue;
    }
    // ⚠ PROVE BEFORE READING ROWS, and read with the FRESH set. Nothing is
    // delivered from a channel the caller left since the last recheck.
    await proveAccessUnlessProvenThisTick();
    counters.polls += 1;
    const found = await read();
    // ⚠ An existence hit that reads back EMPTY must keep HOLDING. Returning
    // `{ pings: [] }` here reads to the caller as "delivered nothing", which is
    // what a TIMEOUT means — and the route derives `timedOut` from exactly this
    // emptiness, so an early return would report a timeout that did not happen.
    if (found.length > 0) pings = found;
  }

  return { pings };
}
