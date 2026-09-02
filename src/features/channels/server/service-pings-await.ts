import "server-only";
import type { ChannelPing } from "../types-ping";
import { AWAIT_POLL_INTERVAL_MS, MAX_PING_LIMIT } from "../constants";
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
 * ── WHY THIS LOOP IS SHORT, AND WHY THAT IS NOT A GAP ───────────────────────
 * The other two holds carry an access re-proof cadence
 * (`AWAIT_REVALIDATE_EVERY_TICKS`) because their fence is a FACT ABOUT THE
 * CALLER that can stop being true mid-hold: a channel membership can be revoked,
 * a channel soft-deleted, and the row read would still name it. **Here the fence
 * IS the SQL predicate.** Every row this hold can read is one the caller is the
 * RECIPIENT of, and that is a column on the row rather than a claim about a
 * relationship elsewhere — so there is nothing to re-prove, no proof that can go
 * stale, and no ordering rule between a proof and a fetch. Adding a recheck here
 * would be a query per tick that could not change a single answer.
 *
 * ⚠ THE ONE THING THAT DOES NOT FOLLOW FROM THAT, stated so nobody re-derives it
 * as a bug: a ping about a channel the caller has SINCE LEFT still reaches them
 * here. That is the designed answer — the signal was addressed to them
 * personally while they were in the room, and the RLS policy's channel-membership
 * arm is what stops it being re-read from the client afterwards. The hold's job
 * is delivery to one person, not continuing access to a room.
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
 *
 * ⚠ **THERE IS NO `revalidations`**, unlike `WorkspaceAwaitCounters`, and the
 * absence is the module docblock's point made in a field list: this fence is a
 * SQL predicate, so no access proof is ever issued and a counter for one would
 * report zero forever.
 */
export interface PingAwaitCounters {
  /** Ping queries issued — existence probes plus row reads. */
  polls: number;
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
 * Hold until a ping addressed to `ctx.userId` exists past `since`, or `deadline`.
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
  const counters: PingAwaitCounters = opts.counters ?? { polls: 0 };

  // ⚠ THE PAGE CEILING IS THE INBOX'S OWN, not a bespoke number: the read is
  // ASCENDING by `seq`, so a burst clipped by the cap is RESUMED by the caller's
  // next `since` rather than skipped.
  const read = () => listPings(ctx, { since, limit: MAX_PING_LIMIT });

  counters.polls += 1;
  let pings = await read();

  while (pings.length === 0 && Date.now() < deadline && !signal?.aborted) {
    await sleep(Math.min(intervalMs, Math.max(0, deadline - Date.now())));
    counters.polls += 1;
    // ⚠ The probe carries the SAME predicates as the row read
    // (`repository-pings.ts › hasPingForRecipient` states the rule): a probe that
    // hits on a row the read then drops spins the hold fetch-empty-continue, one
    // extra pair of queries every tick.
    if (!(await hasPingForRecipient(ctx.userId, ctx.workspaceId, since))) {
      continue;
    }
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
