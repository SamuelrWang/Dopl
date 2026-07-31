import "server-only";
import type { ChannelMessage } from "../types";
import {
  AWAIT_POLL_INTERVAL_MS,
  AWAIT_REVALIDATE_EVERY_TICKS,
} from "../constants";
import {
  hasNewMessages,
  pollChannelMessages,
  revalidateAwaitAccess,
} from "./service-reads";
import type { ChannelContext } from "./service-shared";

/**
 * The await long-poll's HOLD: block until a message with `seq > since` lands
 * (returning it the instant it does) or the deadline passes. Extracted from
 * the route so the loop is unit-testable without a server — the route stays a
 * thin adapter (§ route handlers are ≤80 lines and hold no logic).
 *
 * Q8 EGRESS DIET (2026-07-31). Supabase free-tier egress was at 182% of the
 * 5 GB cap and this loop is the one structurally growing consumer: the
 * teaching tells every agent with an open exchange to keep an await armed
 * continuously, so a listening user held ~1.33 queries/sec, forever. Three
 * shapes changed here, none of them visible to a caller:
 *
 *  1. TICK = EXISTENCE CHECK. Every tick after the first asks `seq > since
 *     LIMIT 1` on one column and fetches full rows ONLY once that hits. It
 *     bounds a tick's work to an index probe no matter how far behind the
 *     cursor is. Tick 0 stays a direct row read on purpose: access was just
 *     validated by `resolveReadableChannelId` and the desktop's wake path
 *     (`timeoutMs=1`) is exactly one tick, so probing first would add a round
 *     trip to the hot wake path and save nothing (a miss returns `[]` either
 *     way).
 *  2. RECHECK CADENCE. `revalidateAwaitAccess` ran EVERY tick — 2 of the 3
 *     queries and ~99% of the bytes. It now runs on the first held tick and
 *     every `AWAIT_REVALIDATE_EVERY_TICKS` after (~15s bounded staleness on
 *     an idle hold), and the queries themselves were narrowed to the columns
 *     the decision reads.
 *  3. THE SECURITY PROPERTY IS ON THE RETURN PATH, NOT THE CADENCE. The
 *     invariant is "no message is DELIVERED to someone who lost access", and
 *     it is enforced as: NO FETCH OF ROWS MAY PRECEDE A PROOF OF ACCESS WITHIN
 *     THE SAME TICK. On an existence hit the hold proves access before reading
 *     rows — via `verifyAccess`, which skips the query only when the periodic
 *     recheck already proved it EARLIER IN THIS TICK, i.e. when the proof is
 *     younger than the probe that found the message and re-asking would return
 *     the same answer. (M2: this used to be described as revalidating
 *     "unconditionally"; the guard has always been there, and the description
 *     was what was wrong.) Loss of access is caught before delivery whatever
 *     the tick count; the cadence only bounds how long a *silent* hold
 *     survives a revocation.
 *
 * Contract preserved byte-for-byte: same cursor semantics, same ordering and
 * limit (`pollChannelMessages`), returns the instant a message arrives, and
 * a `ChannelNotFoundError` from the recheck still ends the hold as a 404.
 */

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Query counters for one hold. Mutated in place — see `AwaitHoldOptions.counters`. */
export interface AwaitHoldCounters {
  /** Message queries issued — existence probes plus row reads. */
  polls: number;
  /** Access rechecks issued (1 query on a public channel, 2 on a private one). */
  revalidations: number;
}

export interface AwaitHoldOptions {
  /** Cursor: only messages with `seq > since` end the hold. */
  since: number | undefined;
  /** Absolute epoch-ms deadline; the hold returns empty once it passes. */
  deadline: number;
  /** Aborts the hold when the client disconnects. */
  signal?: { aborted: boolean };
  /** Tick interval. Overridable so tests don't sleep in real seconds. */
  pollIntervalMs?: number;
  /**
   * L6 — DIAG counters the caller owns, so they survive a THROW. The hold ends
   * in a `ChannelNotFoundError` whenever a mid-hold revocation or soft-delete
   * lands, and with the counts living only in the return value those holds
   * emitted no telemetry at all: the [await-hold] line measured only the holds
   * that ended well, which is the wrong half of the population to watch. Pass
   * an object and it is updated as the loop runs.
   */
  counters?: AwaitHoldCounters;
}

export interface AwaitHoldResult {
  messages: ChannelMessage[];
  /** DIAG (Q8): message queries issued — existence probes plus row reads. */
  polls: number;
  /**
   * DIAG (Q8): access rechecks issued. Each is 1 query on a public channel,
   * 2 on a private one (channel + membership).
   */
  revalidations: number;
}

/**
 * Hold on an ALREADY-RESOLVED channel id (`resolveReadableChannelId` ran the
 * full visibility gate) until messages past `since` exist or `deadline`.
 */
export async function awaitNewMessages(
  ctx: ChannelContext,
  channelId: string,
  opts: AwaitHoldOptions
): Promise<AwaitHoldResult> {
  const { since, deadline, signal } = opts;
  const intervalMs = opts.pollIntervalMs ?? AWAIT_POLL_INTERVAL_MS;

  // L6: the caller's object when it passed one, so a hold that ends in a throw
  // still leaves its counts behind for the telemetry line.
  const counters: AwaitHoldCounters = opts.counters ?? {
    polls: 0,
    revalidations: 0,
  };
  // Ticks elapsed, and the tick at which access was last proven. Tick 0 is
  // proven by `resolveReadableChannelId`, so the hot single-tick wake path
  // costs no recheck at all.
  let ticks = 0;
  let verifiedAtTick = 0;

  /**
   * Prove access, unless it was already proven EARLIER IN THIS TICK. The skip
   * is what keeps the invariant honest rather than weakening it: a proof from
   * this same tick necessarily predates the fetch that follows, so re-running
   * the identical query cannot learn anything the first one missed. Never
   * widen this to "already proven recently" — a proof from an earlier tick is
   * exactly the one a revocation can have landed after.
   */
  const verifyAccess = async () => {
    if (verifiedAtTick === ticks) return;
    await revalidateAwaitAccess(ctx, channelId);
    verifiedAtTick = ticks;
    counters.revalidations += 1;
  };

  counters.polls += 1;
  let messages = await pollChannelMessages(channelId, since);

  while (
    messages.length === 0 &&
    Date.now() < deadline &&
    !signal?.aborted
  ) {
    await sleep(Math.min(intervalMs, Math.max(0, deadline - Date.now())));
    ticks += 1;
    // Background recheck: first held tick, then every Nth. A soft-delete or a
    // membership revocation throws ChannelNotFoundError (-> 404) and ends the
    // hold rather than leaving it listening to a channel it can no longer see.
    if ((ticks - 1) % AWAIT_REVALIDATE_EVERY_TICKS === 0) await verifyAccess();
    counters.polls += 1;
    if (!(await hasNewMessages(channelId, since))) continue;
    // A hit: prove access BEFORE reading rows, so nothing is ever delivered to
    // a caller who lost it since the last recheck.
    await verifyAccess();
    counters.polls += 1;
    const found = await pollChannelMessages(channelId, since);
    // Defensive: an existence hit that reads back empty (a row removed in
    // between) must keep holding, never return `{messages: [], timedOut:
    // false}` — that shape means "delivered nothing" to every caller.
    if (found.length > 0) messages = found;
  }

  return {
    messages,
    polls: counters.polls,
    revalidations: counters.revalidations,
  };
}
