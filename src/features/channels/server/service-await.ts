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
 * (returning it instantly) or the deadline passes. Extracted from the route so
 * the loop is unit-testable without a server.
 *
 * ⚠ This loop is the feature's one structurally growing egress consumer — the
 * teaching tells every agent with an open exchange to keep an await armed
 * continuously. Three shapes exist for that, none caller-visible:
 *
 *  1. TICK = EXISTENCE CHECK. Every tick after the first asks
 *     `seq > since LIMIT 1` on one column and fetches rows ONLY once that hits.
 *     ⚠ Tick 0 stays a direct row read on purpose: access was just validated by
 *     `resolveReadableChannelId` and the desktop's wake path (`timeoutMs=1`) is
 *     exactly one tick, so probing first adds a round trip and saves nothing.
 *  2. RECHECK CADENCE. `revalidateAwaitAccess` runs on the first held tick and
 *     every `AWAIT_REVALIDATE_EVERY_TICKS` after (~15s bounded staleness on an
 *     idle hold), narrowed to the columns the decision reads.
 *  3. ⚠ THE SECURITY PROPERTY IS ON THE RETURN PATH, NOT THE CADENCE:
 *     NO FETCH OF ROWS MAY PRECEDE A PROOF OF ACCESS WITHIN THE SAME TICK. On
 *     an existence hit the hold proves access before reading rows via
 *     `verifyAccess`, which skips the query only when the periodic recheck
 *     already proved it EARLIER IN THIS TICK. Loss of access is caught before
 *     delivery at any tick count; the cadence only bounds how long a SILENT
 *     hold survives a revocation.
 *
 * ⚠ Contract preserved byte-for-byte: same cursor semantics, ordering and limit
 * (`pollChannelMessages`), instant return, and a `ChannelNotFoundError` from the
 * recheck still ends the hold as a 404.
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
  /**
   * Messages by this author neither end the hold nor appear in its page. ⚠ A
   * caller that posts while its own await is armed otherwise pops its own hold
   * on its own echo, defeating the wake primitive for exactly the multi-step
   * work it exists for. Absent = every author ends the hold (desktop listener).
   */
  excludeAuthor?: string;
  /** Aborts the hold when the client disconnects. */
  signal?: { aborted: boolean };
  /** Tick interval. Overridable so tests don't sleep in real seconds. */
  pollIntervalMs?: number;
  /**
   * ⚠ Counters the CALLER owns, so they survive a THROW. The hold ends in
   * `ChannelNotFoundError` on any mid-hold revocation or soft-delete, and counts
   * living only in the return value lose exactly the holds worth watching.
   */
  counters?: AwaitHoldCounters;
}

export interface AwaitHoldResult {
  messages: ChannelMessage[];
  /** DIAG (Q8): message queries issued — existence probes plus row reads. */
  polls: number;
  /** Access rechecks issued — 1 query on a public channel, 2 on a private one
   *  (channel + membership). */
  revalidations: number;
}

/**
 * Hold on an ALREADY-RESOLVED channel id (`resolveReadableChannelId` ran the
 * full visibility gate) until messages past `since` exist, or `deadline`.
 */
export async function awaitNewMessages(
  ctx: ChannelContext,
  channelId: string,
  opts: AwaitHoldOptions
): Promise<AwaitHoldResult> {
  const { since, deadline, signal, excludeAuthor } = opts;
  const intervalMs = opts.pollIntervalMs ?? AWAIT_POLL_INTERVAL_MS;

  // Caller's object when it passed one, so a hold ending in a throw still
  // leaves its counts behind.
  const counters: AwaitHoldCounters = opts.counters ?? {
    polls: 0,
    revalidations: 0,
  };
  // Ticks elapsed, and the tick access was last proven at. ⚠ Tick 0 is proven by
  // `resolveReadableChannelId`, so the hot single-tick wake path costs no
  // recheck at all.
  let ticks = 0;
  let verifiedAtTick = 0;

  /**
   * Prove access unless already proven EARLIER IN THIS TICK — a proof from the
   * same tick necessarily predates the fetch that follows, so re-running the
   * identical query learns nothing.
   * ⚠ NEVER widen this to "already proven recently": a proof from an earlier
   * tick is exactly the one a revocation can have landed after.
   */
  const verifyAccess = async () => {
    if (verifiedAtTick === ticks) return;
    await revalidateAwaitAccess(ctx, channelId);
    verifiedAtTick = ticks;
    counters.revalidations += 1;
  };

  counters.polls += 1;
  let messages = await pollChannelMessages(channelId, ctx.workspaceId, since, excludeAuthor);

  while (
    messages.length === 0 &&
    Date.now() < deadline &&
    !signal?.aborted
  ) {
    await sleep(Math.min(intervalMs, Math.max(0, deadline - Date.now())));
    ticks += 1;
    // Background recheck: first held tick, then every Nth. A soft-delete or
    // revocation throws ChannelNotFoundError and ends the hold.
    if ((ticks - 1) % AWAIT_REVALIDATE_EVERY_TICKS === 0) await verifyAccess();
    counters.polls += 1;
    // ⚠ The probe carries the SAME author filter as the row read — an existence
    // hit on a message the page then drops spins the hold fetch-empty-continue,
    // one extra pair of queries every tick.
    if (!(await hasNewMessages(channelId, since, excludeAuthor))) continue;
    // ⚠ Prove access BEFORE reading rows, so nothing is delivered to a caller
    // who lost it since the last recheck.
    await verifyAccess();
    counters.polls += 1;
    const found = await pollChannelMessages(channelId, ctx.workspaceId, since, excludeAuthor);
    // ⚠ An existence hit that reads back empty must keep HOLDING — never return
    // `{messages: [], timedOut: false}`, which reads as "delivered nothing".
    if (found.length > 0) messages = found;
  }

  return {
    messages,
    polls: counters.polls,
    revalidations: counters.revalidations,
  };
}
