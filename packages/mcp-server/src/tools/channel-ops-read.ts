/**
 * `dopl_channel` READ op handlers: list (channels), read (messages),
 * list_threads / get_thread, members. All non-mutating, and all of them ONE
 * round-trip rendered.
 *
 * `await` used to live here and now has its own module,
 * `channel-ops-await.ts` — split at the §2 500-line cap when `read` gained its
 * `thread` filter, on the seam this file had already drawn twice
 * (`channel-await-budget.ts` took the clocks, `channel-wake-guidance.ts` the
 * wake claims). It is the only op here that loops, and nothing in it was shared
 * with these beyond the renderers.
 *
 * BOUNDARY: the wire/storage name `task` == the domain name `thread` — the
 * `thread` op param still resolves against `channel_tasks` rows and the
 * `/tasks` routes underneath `@dopl/client`.
 *
 * Every STRING these ops emit — the author labels, the thread renders, the
 * channel lines, and the untrusted-content headers that frame them — lives in
 * `channel-render.ts`. That split is where the peer-authored-text discipline is
 * documented and enforced (Q1); this file is control flow.
 */

import type {
  ChannelMember,
  ChannelMessage,
  ChannelThreadDetail,
  DoplClient,
} from "@dopl/client";
import { ok, err, isNotFound, type ToolResponse } from "./respond";
import { channelNotFound, inlineOr, memberNames } from "./channel-shared";
import {
  UNTRUSTED_BODY_HEADER,
  UNTRUSTED_LISTING_HEADER,
  UNTRUSTED_ROSTER_HEADER,
  UNTRUSTED_THREAD_HEADER,
  formatChannelLine,
  formatMemberLine,
  formatMessages,
  formatThreadDetail,
  formatThreadLine,
} from "./channel-render";
// Whether anything in a page names an AGENT — the predicate that keeps the
// roster read off the hot path (BLOCKER-3).
import { anyAgentAddressed } from "./channel-render-agents";
// The addressing rule has ONE statement, in one module — see
// channel-addressing.ts for what each half of it is verified against.
import { rosterAddressingRule } from "./channel-addressing";
// Breakout-room membership: the set a thread read now carries, and the handles
// that name the agents in it. Both fail soft.
import {
  agentAddressIndex,
  agentNamesById,
  participantLines,
} from "./channel-agent-refs";

/** Peer text that neutralized to nothing — never an empty span. */
const NO_ID = "(unreadable id)";

export async function opList(client: DoplClient): Promise<ToolResponse> {
  const channels = await client.listChannels();
  if (channels.length === 0) {
    return ok(
      'No channels yet. Create one with dopl_channel(op="open", name="...").',
    );
  }
  const lines = [
    `## Channels — ${channels.length}\n`,
    // Q1-A: framing FIRST. This listing renders member-typed names and topics,
    // and a PUBLIC channel puts a stranger's text in front of an agent that
    // never opted into contact with them — in the op the tool description tells
    // it to start with.
    `${UNTRUSTED_LISTING_HEADER}\n`,
  ];
  for (const c of channels) lines.push(formatChannelLine(c));
  lines.push(
    '\nRead a channel with dopl_channel(op="read", channel=<slug|id>); post with op="post"; watch for new messages with op="await".',
  );
  return ok(lines.join("\n"));
}

/**
 * Read a channel's transcript, optionally SCOPED TO ONE THREAD.
 *
 * `thread` is a FILTER, not a lookup, and every string below is written from
 * that fact: the route keeps only the rows whose `metadata.taskId` equals it,
 * an id nothing carries returns `[]` rather than a 404, and any non-empty
 * string is legal — a thread id is a `channel_tasks` uuid today, but the
 * transcript still carries legacy `task-<channelId>-<seq>` ids and those are
 * the exchanges hardest to reconstruct by hand. Blank/whitespace is treated as
 * unset rather than sent, so a caller that passes `thread=""` gets the channel
 * read it meant instead of a 400 from the route's `min(1)`.
 *
 * WHAT THE FILTERED RESULT MAY NOT SAY: `await` has no thread parameter and
 * never will have one silently (a filtered hold would miss the messages an
 * agent must follow — see `channel-ops-await.ts`). So the seq this reports is
 * this THREAD's high-water mark, not the channel's, and the watch hint it hands
 * back is a plain channel-wide await. Suggesting a thread-scoped wait here is
 * how an agent ends up armed on a call that cannot exist.
 *
 * P1-8 (2026-08-04) — AND THE HINT USED TO CARRY THE WRONG NUMBER, WHICH LOST
 * MESSAGES SILENTLY. The line said "Highest seq shown: N", warned in prose that N
 * is thread-local and not channel-wide, and then interpolated THAT SAME N into
 * `op="await", since=N`. `await` is channel-wide with a strict `gt("seq", since)`,
 * so an agent following the tool's own suggestion skipped EVERY message below N
 * in every other exchange — permanently, since the cursor only moves forward. The
 * warning made it worse: it told the agent the number was wrong and then used it.
 *
 * So the CHANNEL-WIDE max is fetched and that is what the await suggestion
 * carries; the thread max stays as display only. It costs one extra round-trip,
 * on a cold path — a thread-scoped read, never the poll loop — and it FAILS SOFT:
 * if the channel-wide max cannot be read, the suggestion states no number at all
 * rather than falling back to the one that is known to be wrong.
 */

/**
 * The channel's own highest seq, or null when it cannot be read.
 *
 * `limit=1` with no `since` is the NEWEST message (the route's documented
 * behaviour, and the same shape `create_thread`'s cursor advice names), so one
 * row answers it. Null on ANY failure — an empty channel, a transport error, a
 * shape this build does not expect — because the whole point is that a wrong
 * number here is worse than no number.
 */
async function channelWideMaxSeq(
  client: DoplClient,
  ref: string,
): Promise<number | null> {
  try {
    const newest = await client.readChannelMessages(ref, { limit: 1 });
    const seq = newest[newest.length - 1]?.seq;
    return typeof seq === "number" ? seq : null;
  } catch {
    return null;
  }
}
export async function opRead(
  client: DoplClient,
  ref: string,
  since?: number,
  limit?: number,
  selfUserId: string | null = null,
  thread?: string,
): Promise<ToolResponse> {
  const scope = thread?.trim() ? thread.trim() : undefined;
  // Q1-E — the id ROUND TRIPS: an agent copies it out of a `read` legend, and a
  // legend id is `metadata.taskId`, which a peer stores verbatim for any
  // non-UUID value. A hand-built code span is not a container (one backtick in
  // the value opens it), so it goes through the same helper as its siblings.
  const safeScope = scope ? inlineOr(scope, NO_ID) : "";
  // Hot path — no pre-resolve. The route accepts slug-or-id in the
  // [channelId] segment and enforces visibility itself, so we hand it the
  // caller's ref directly and skip a per-call listChannels() round-trip. A
  // route 404 (unknown ref, or one the caller can't see) maps to a clean
  // not-found; the ref stands in for the channel name in the output.
  let messages: ChannelMessage[];
  try {
    messages = await client.readChannelMessages(ref, {
      since,
      limit,
      thread: scope,
    });
  } catch (e) {
    if (isNotFound(e)) return channelNotFound(ref);
    throw e;
  }
  const watch = `dopl_channel(op="await", channel="${ref}", since=`;
  if (messages.length === 0) {
    const sinceNote = since !== undefined ? ` after seq ${since}` : "";
    if (scope) {
      return ok(
        `No messages tagged with thread ${safeScope} in **${ref}**${sinceNote}. \`thread\` FILTERS the transcript — an id no message carries comes back empty rather than as an error — so check the id with dopl_channel(op="list_threads", channel="${ref}") before you conclude the exchange is silent, or drop \`thread\` to read the whole channel. Watch for new messages with ${watch}${since ?? 0}); await is channel-wide and takes no thread.`,
      );
    }
    return ok(
      `No messages in **${ref}**${sinceNote}. Watch for new ones with ${watch}${since ?? 0}).`,
    );
  }
  const count = `${messages.length} message${messages.length === 1 ? "" : "s"}`;
  const lines = [
    scope
      ? `## ${ref} — ${count} in thread ${safeScope} (ONE exchange, not the whole channel)\n`
      : `## ${ref} — ${count}\n`,
    // Framing FIRST — this listing renders counterparty-authored bodies, and a
    // caveat placed under them is read after the injected line it warns about.
    `${UNTRUSTED_BODY_HEADER}\n`,
  ];
  // BLOCKER-3 — the handles for any agents these messages ADDRESS. Fetched
  // ONLY when something in the page actually names one, so an ordinary
  // transcript (and the poll loop behind it) pays nothing: this is the hot
  // path, and the whole reason `read` skips `resolveChannelOr`. Fails soft —
  // an unreadable roster renders the ids bare, never an error.
  const agentNames = anyAgentAddressed(messages)
    ? (await agentAddressIndex(client, ref, selfUserId)).names
    : undefined;
  lines.push(...formatMessages(messages, ref, selfUserId, agentNames));
  const lastSeq = messages[messages.length - 1].seq;
  if (!scope) {
    // A channel-wide read already IS the channel-wide cursor.
    lines.push(
      `\nHighest seq shown: ${lastSeq}. Watch for newer messages with ${watch}${lastSeq}).`,
    );
    return ok(lines.join("\n"));
  }
  // P1-8 — the await cursor is the CHANNEL's high-water mark, never this
  // thread's. See the docblock for the message loss the old line caused.
  const channelSeq = await channelWideMaxSeq(client, ref);
  lines.push(
    channelSeq === null
      ? `\nHighest seq shown: ${lastSeq} — the highest in THIS thread, not in the channel; messages in other exchanges may sit above it. DO NOT pass that number to \`await\`: await is channel-wide with a strict "greater than", so a thread-local seq skips every message below it in every other exchange, permanently. This call could not read the channel's own highest seq, so get it first — dopl_channel(op="read", channel="${ref}", limit=1) — and await from THAT. Drop \`thread\` for the full transcript.`
      : `\nHighest seq shown: ${lastSeq} — the highest in THIS thread, not in the channel; messages in other exchanges may sit above it, and the channel's own highest is ${channelSeq}. Watch for newer messages with ${watch}${channelSeq}): that is the CHANNEL-wide cursor, which is the only kind await takes — passing the thread-local ${lastSeq} would skip everything between the two, permanently. await returns whatever lands next, in any exchange. Drop \`thread\` for the full transcript.`,
  );
  return ok(lines.join("\n"));
}

export async function opListThreads(
  client: DoplClient,
  ref: string,
  selfUserId: string | null = null,
): Promise<ToolResponse> {
  // Hot-path parity with read/await: hand the ref straight to the route
  // (slug-or-id + visibility enforced there) and map a 404 to a clean
  // not-found, rather than pre-resolving via listChannels.
  let threads: ChannelThreadDetail[];
  try {
    threads = await client.listChannelThreads(ref);
  } catch (e) {
    if (isNotFound(e)) return channelNotFound(ref);
    throw e;
  }
  if (threads.length === 0) {
    return ok(
      `No threads in **${ref}**. Open one with dopl_channel(op="create_thread", channel="${ref}", title="...", body="...", to="...").`,
    );
  }
  const lines = [
    `## ${ref} — ${threads.length} thread${threads.length === 1 ? "" : "s"}\n`,
    // Q1-B: framing FIRST. Titles and outcome summaries below are peer-typed,
    // and `listChannelTasks` is channel-transparent — every member of the
    // channel receives every thread's text, not just their own.
    `${UNTRUSTED_THREAD_HEADER}\n`,
  ];
  // Names for the two ids on every thread line. One extra call, on a cold op
  // (not the poll loop), and fail-soft — see `memberNames`.
  const view = { selfUserId, names: await memberNames(client, ref) };
  for (const t of threads) lines.push(formatThreadLine(t, view));
  lines.push(
    `\nInspect one with dopl_channel(op="get_thread", channel="${ref}", thread=<id>); read its messages with op="read" (pass the same thread=<id> to see only that exchange). A thread accepts posts ONLY from the member who opened it and the member it is addressed to — everyone else in the channel can read it and is refused if they post into it.`,
  );
  return ok(lines.join("\n"));
}

export async function opGetThread(
  client: DoplClient,
  ref: string,
  threadId: string,
  selfUserId: string | null = null,
): Promise<ToolResponse> {
  let thread: ChannelThreadDetail;
  try {
    thread = await client.getChannelThread(ref, threadId);
  } catch (e) {
    // The route 404s both an unknown channel ref and a thread not in this
    // channel; surface a thread-oriented not-found either way.
    //
    // Q1-E — `threadId` is the caller's own argument, but unlike `ref` it ROUND
    // TRIPS: an agent reads a thread id out of a `read` legend, and a legend id
    // is `metadata.taskId`, which a peer stores verbatim for any non-UUID value.
    // A hand-built code span is not a container — one backtick in the value
    // opens it — so it goes through the same helper as its siblings in
    // `channel-ops-threads.ts`. `ref` stays raw: it is the channel argument the
    // caller just passed and nothing peer-authored reaches it.
    if (isNotFound(e)) {
      return err(
        `No thread ${inlineOr(threadId, NO_ID)} in **${ref}**. List a channel's threads with dopl_channel(op="list_threads", channel="${ref}").`,
      );
    }
    throw e;
  }
  // Q1-C: framing FIRST, above the `## Thread <title>` heading rather than
  // under it. The product tells a waiting agent to call this op every ~3 empty
  // holds, so it is a peer-typed title an agent re-reads on a timer.
  const view = { selfUserId, names: await memberNames(client, ref) };
  // MULTIPLAYER — the PARTICIPANT SET, which is the fact this op exists to
  // answer for an agent under the law "act on your own room": a thread with a
  // set is a breakout room and the set is who may post into it. Rendered here
  // rather than inside `formatThreadDetail` because naming the agents in it
  // needs a roster the pure renderer has no way to fetch. Both lookups fail
  // soft — an unreadable roster degrades to ids, never to an error.
  const agentNames = await agentNamesById(client, ref);
  return ok(
    [
      UNTRUSTED_THREAD_HEADER,
      ``,
      formatThreadDetail(thread, view),
      ...participantLines(thread.participants, view, agentNames),
    ].join("\n"),
  );
}

/**
 * The channel ROSTER — who is actually in here.
 *
 * The gap this closes: `op="list"` reported "5 members" and NOTHING in the tool
 * said who they were, while `post` and `create_thread` both require addressing a
 * specific member and an unaddressed ask in a 3+ member channel triggers nobody.
 * An agent could see that a channel was a group, could be told to address one
 * member, and had no op that would tell it which members existed.
 *
 * Read-only, and it renders exactly what the roster route returns — the private
 * per-member preferences (notify scope, agent tool profile) are already scrubbed
 * server-side for everyone but the caller, and none of them are rendered here.
 */
export async function opMembers(
  client: DoplClient,
  ref: string,
  selfUserId: string | null = null,
): Promise<ToolResponse> {
  let members: ChannelMember[];
  try {
    members = await client.listChannelMembers(ref);
  } catch (e) {
    if (isNotFound(e)) return channelNotFound(ref);
    throw e;
  }
  if (members.length === 0) {
    return ok(`No members visible in **${ref}**.`);
  }
  const lines = [
    `## ${ref} — ${members.length} member${members.length === 1 ? "" : "s"}\n`,
    `${UNTRUSTED_ROSTER_HEADER}\n`,
  ];
  for (const m of members) lines.push(formatMemberLine(m, selfUserId));
  if (selfUserId === null) {
    // Never guess which row is the caller: the boot handshake is the only
    // source of that id here, and when it failed the honest answer is to say so.
    lines.push(
      `\nNo row is marked "you" — this connection could not resolve your own user id at startup.`,
    );
  }
  // TWO rules, and they are NOT the same rule. AUTO-ADDRESSING keys on
  // `is_direct` (`resolveDirectPeer` stamps nothing without it), which this op
  // cannot see. The IMPLICIT TRIGGER on the receiving machine keys on the MEMBER
  // COUNT (`classify`, targeting.js:152) — which this op has just counted
  // exactly. The first version of this line collapsed the two and told a
  // two-member channel its unaddressed messages reach nobody; they reach the
  // only other member. `rosterAddressingRule` states each from what it knows.
  lines.push(rosterAddressingRule(ref, members.length));
  return ok(lines.join("\n"));
}
