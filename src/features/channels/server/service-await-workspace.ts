import "server-only";
import type { ChannelMessage } from "../types";
import {
  AWAIT_POLL_INTERVAL_MS,
  AWAIT_REVALIDATE_EVERY_TICKS,
} from "../constants";
import { mapMessageRow } from "./dto";
import {
  hasWorkspaceMessagesAfter,
  listMemberChannelRefs,
  listWorkspaceMessagesAfter,
  type MemberChannelRef,
} from "./repository-await-workspace";
import { profilesById, type ChannelContext } from "./service-shared";

/**
 * THE **WORKSPACE-WIDE** AWAIT HOLD — `op="await"` with no `channel`: block until
 * a message lands in ANY channel the caller is a member of, or the deadline
 * passes.
 *
 * ⚠ **A SIBLING OF `service-await.ts › awaitNewMessages`, NEVER A GENERALIZATION
 * OF IT.** That loop is the hottest path in the tree and its shape is tuned as a
 * whole; adding a "channel or workspace" mode to it would put two authorization
 * stories behind one signature — which is the same reason
 * `repository-sessions.ts › sessionRowsWhere` shares plumbing and refuses to
 * share a fence. What IS shared here is the SHAPE of the argument, deliberately
 * restated rather than imported, so a change to one is a visible decision about
 * the other.
 *
 * ── WHY ONE CURSOR IS ENOUGH ───────────────────────────────────────────────
 * `channel_messages.seq` is **workspace-global and gappy** (INVARIANTS §5 — the
 * property that makes a per-channel seq RANGE meaningless as a message count).
 * That is exactly what makes ONE cursor legal across every channel at once:
 * ordering by it interleaves channels in true arrival order, and a caller that
 * advances to the highest seq on a page has provably seen everything below it in
 * EVERY channel on that page. No per-channel bookkeeping, no second cursor, and
 * no way for a quiet channel to be skipped by a busy one.
 *
 * ── THE ACCESS INVARIANT (M2), AND HOW IT IS PRESERVED HERE ─────────────────
 * The per-channel hold's security property is stated in `constants.ts ›
 * AWAIT_REVALIDATE_EVERY_TICKS`: **NO FETCH OF MESSAGE ROWS MAY PRECEDE A PROOF
 * OF ACCESS WITHIN THE SAME TICK.** It is enforced on the RETURN path, not by the
 * recheck cadence — the cadence only bounds how long a SILENT hold survives a
 * revocation.
 *
 * The workspace hold preserves it **by construction rather than by ordering**,
 * which is stronger and worth reading twice:
 *   1. THE PROOF IS THE FENCE. `listMemberChannelRefs` returns the membership∩
 *      live-channels set, and that array IS the `WHERE channel_id IN (…)` of both
 *      the probe and the row read. There is no query here that could run against
 *      a wider set — a stale proof cannot leak rows from a channel it never
 *      named, it can only leak rows from a channel the caller has SINCE left.
 *   2. SO THE ORDERING RULE STILL APPLIES, VERBATIM. On an existence HIT the hold
 *      re-proves access before reading rows — `proveAccess()` — unless the
 *      periodic recheck already proved it EARLIER IN THIS TICK, in which case the
 *      proof necessarily predates the fetch and re-running the identical query
 *      learns nothing. ⚠ **NEVER widen that to "already proven recently": a proof
 *      from an earlier tick is exactly the one a revocation can have landed
 *      after.**
 *   3. AND THE FETCH USES THE FRESH SET, not the one the probe ran on. That is
 *      the workspace-specific half: re-proving is pointless if the read still
 *      names the old channel ids, so `proveAccess` REPLACES `refs` and the row
 *      read closes over the current value.
 *   4. TICK 0 is proven by the read the hold opens with, before any row is
 *      fetched — the counterpart of `resolveReadableChannelId` on the
 *      per-channel path.
 *
 * ⚠ **A CHANNEL THE CALLER IS NOT A MEMBER OF CANNOT APPEAR ON ANY PAGE**, and a
 * PRIVATE one they were never in cannot even be probed: it is absent from every
 * `IN (…)` this hold ever issues. That is the adversarial case
 * `service-await-workspace.test.ts` drives directly.
 *
 * ⚠ MEMBERSHIP IS DELIBERATELY NARROWER THAN `op="read"`'s VISIBILITY, which
 * admits a non-member to a PUBLIC channel. The argument is in
 * `repository-await-workspace.ts › listMemberChannelRefs`; the safety direction
 * is the important half — fewer rows is never a leak.
 */

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Query counters for one workspace hold. ⚠ Mutated in place, so a hold that
 *  ends in a THROW still leaves its counts with the caller. */
export interface WorkspaceAwaitCounters {
  /** Message queries issued — existence probes plus row reads. */
  polls: number;
  /** Membership proofs issued. ⚠ TWO queries each (memberships, then channels),
   *  the same budget `revalidateAwaitAccess` pays on a private channel. */
  revalidations: number;
}

export interface WorkspaceAwaitOptions {
  since: number | undefined;
  /** Absolute epoch-ms deadline; the hold returns empty once it passes. */
  deadline: number;
  /**
   * Messages by this author neither end the hold nor appear in its page. ⚠ Same
   * rule and same reason as the per-channel hold: a caller that posts while its
   * own await is armed otherwise pops its hold on its own echo — and across a
   * WHOLE WORKSPACE that misfire is strictly more likely, because every channel
   * the caller posts into can now trip it.
   */
  excludeAuthor?: string;
  signal?: { aborted: boolean };
  pollIntervalMs?: number;
  counters?: WorkspaceAwaitCounters;
}

/** A message plus the channel it came from — a workspace page spans several. */
export interface WorkspaceChannelMessage extends ChannelMessage {
  channelName: string | null;
  channelSlug: string | null;
}

export interface WorkspaceAwaitResult {
  messages: WorkspaceChannelMessage[];
  /** How many channels the hold was watching when it returned. ⚠ Reported so a
   *  caller with ZERO memberships is told that rather than shown an empty page
   *  it would read as "nothing happened". */
  channelCount: number;
  polls: number;
  revalidations: number;
}

/**
 * Hold across every channel the caller is a member of until messages past
 * `since` exist, or `deadline`.
 */
export async function awaitWorkspaceMessages(
  ctx: ChannelContext,
  opts: WorkspaceAwaitOptions
): Promise<WorkspaceAwaitResult> {
  const { since, deadline, signal, excludeAuthor } = opts;
  const intervalMs = opts.pollIntervalMs ?? AWAIT_POLL_INTERVAL_MS;
  const counters: WorkspaceAwaitCounters = opts.counters ?? {
    polls: 0,
    revalidations: 0,
  };

  let ticks = 0;
  let verifiedAtTick = 0;
  let refs: MemberChannelRef[] = [];

  /**
   * Re-read the membership set unless it was already read EARLIER IN THIS TICK.
   * ⚠ It REPLACES `refs`, and that is the point: a proof that did not narrow the
   * next query is not a proof of anything.
   */
  const proveAccess = async () => {
    refs = await listMemberChannelRefs(ctx.workspaceId, ctx.userId);
    verifiedAtTick = ticks;
    counters.revalidations += 1;
  };
  const proveAccessUnlessProvenThisTick = async () => {
    if (verifiedAtTick === ticks) return;
    await proveAccess();
  };

  // ⚠ TICK 0's PROOF, and it runs BEFORE any row is fetched. There is no
  // `resolveReadableChannelId` on this path to have done it already.
  await proveAccess();

  const ids = () => refs.map((r) => r.id);

  counters.polls += 1;
  let rows = await listWorkspaceMessagesAfter(ids(), since, excludeAuthor);

  while (rows.length === 0 && Date.now() < deadline && !signal?.aborted) {
    await sleep(Math.min(intervalMs, Math.max(0, deadline - Date.now())));
    ticks += 1;
    // Background recheck: first held tick, then every Nth — the same cadence and
    // the same ~15s bounded staleness the per-channel hold runs.
    if ((ticks - 1) % AWAIT_REVALIDATE_EVERY_TICKS === 0) {
      await proveAccessUnlessProvenThisTick();
    }
    counters.polls += 1;
    // ⚠ The probe carries the SAME channel set and the SAME author filter as the
    // row read — an existence hit on a row the page then drops spins the hold
    // fetch-empty-continue, one extra pair of queries every tick.
    if (!(await hasWorkspaceMessagesAfter(ids(), since, excludeAuthor))) continue;
    // ⚠ PROVE ACCESS BEFORE READING ROWS, and read with the FRESH set — see the
    // module docblock's point 3. Nothing is delivered from a channel the caller
    // left since the last recheck.
    await proveAccessUnlessProvenThisTick();
    counters.polls += 1;
    const found = await listWorkspaceMessagesAfter(ids(), since, excludeAuthor);
    // ⚠ An existence hit that reads back empty must keep HOLDING — returning an
    // empty page here reads to the caller as "delivered nothing", which is what
    // a timeout means, and the two are different facts.
    if (found.length > 0) rows = found;
  }

  const byChannel = new Map(refs.map((r) => [r.id, r]));
  const authorIds = rows
    .map((r) => r.author_user_id)
    .filter((id): id is string => id !== null);
  const profiles = await profilesById(authorIds);
  const messages: WorkspaceChannelMessage[] = rows.map((row) => {
    const base = mapMessageRow(
      row,
      row.author_user_id ? profiles.get(row.author_user_id) : undefined
    );
    const ref = byChannel.get(row.channel_id);
    // ⚠ `null` WHEN THE CHANNEL COULD NOT BE RESOLVED, never an empty string: a
    // render must fall back to the id rather than print a blank label. This is
    // reachable — a channel can be deleted between the proof and the hydration.
    return {
      ...base,
      channelName: ref?.name ?? null,
      channelSlug: ref?.slug ?? null,
    };
  });

  return {
    messages,
    channelCount: refs.length,
    polls: counters.polls,
    revalidations: counters.revalidations,
  };
}
