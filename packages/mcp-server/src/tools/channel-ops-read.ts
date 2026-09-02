/**
 * `dopl_channel` READ op handlers: list, read, list_threads, members. All
 * non-mutating, all ONE round-trip rendered — except a THREAD-SCOPED `read`,
 * which is two. `await` lives in `channel-ops-await.ts` (the only looping op).
 *
 * ⚠ **`op="get_thread"` WAS FOLDED INTO `read(thread=)` ON 2026-09-02 (C15).**
 * Two ops answered one noun — "what is this exchange" — and the split cost 200
 * characters of published prose explaining that the first returned no bodies.
 * A thread-scoped read now carries the METADATA HEADER that op rendered, above
 * the transcript it always rendered, so the fold deleted an op and no answer.
 *
 * ⚠ BOUNDARY: wire/storage name `task` == domain name `thread` — the `thread`
 * op param resolves against `channel_tasks` rows and `/tasks` routes under
 * `@dopl/client`.
 *
 * Every STRING these ops emit lives in `channel-render.ts`, where the
 * peer-authored-text discipline is documented and enforced. This file is
 * control flow.
 */

import type {
  ChannelMember,
  ChannelMessage,
  ChannelSessionsPage,
  ChannelThread,
  DoplClient,
} from "@dopl/client";
import { ok, isNotFound, type ToolResponse } from "./respond";
import {
  channelNotFound,
  inlineOr,
  isErr,
  memberNames,
  resolveChannelOr,
} from "./channel-shared";
import {
  formatChannelLine,
  formatMemberLine,
  formatMessages,
  formatThreadDetail,
  formatThreadLine,
  type MemberView,
} from "./channel-render";
import { UNTRUSTED_ROSTER_HEADER, UNTRUSTED_THREAD_HEADER } from "./channel-framing";
// ⚠ The clipped-list wording lives with the other thread-render prose, stated
// once — see INVARIANTS §9.
import { isConcise, type ResponseFormat } from "./response-size";
import { threadsClippedNote } from "./channel-render-threads";
// ⚠ Addressing rule has ONE statement, in channel-addressing.ts.
import { rosterAddressingRule } from "./channel-addressing";
// ⚠ THE ONE LINE A READ RESULT SPENDS ON THE RULES. Every standing paragraph
// these ops used to close with is in `channel-doctrine.ts`, behind `op="help"`
// and the `dopl://doctrine/channels` resource.
import { DOCTRINE_POINTER } from "./channel-doctrine";
// ⚠ The session LINE — staleness hedge + operator-only telemetry — has ONE
// statement, in channel-session-render.ts, shared with `await`'s session block.
import { sessionIsStale, sessionLegend } from "./channel-session-render";
import { SESSION_TABLE_HEAD, sessionRow } from "./channel-session-table";

/** Peer text that neutralized to nothing — never an empty span. */
const NO_ID = "(unreadable id)";

export async function opList(client: DoplClient): Promise<ToolResponse> {
  const channels = await client.listChannels();
  if (channels.length === 0) {
    return ok(
      'No channels yet. Create one with dopl_channel(op="open", name="...").',
    );
  }
  // ⚠ NO PER-RESULT SECURITY BANNER (T11, 2026-09-02). The framing did not go
  // away — it moved to CHANNEL_DESCRIPTION's own SECURITY paragraph, which is
  // read at connection and covers every result this tool returns. It is
  // repeated here no longer because ~3k chars of identical banner on every
  // read/list/await is what the orchestrator loop actually pays.
  const lines = [`## Channels — ${channels.length}\n`];
  for (const c of channels) lines.push(formatChannelLine(c));
  lines.push(
    '\nRead a channel with dopl_channel(op="read", channel=<slug|id>); post with op="post"; watch for new messages with op="await".',
  );
  return ok(lines.join("\n"));
}

/**
 * Read a channel's transcript, optionally SCOPED TO ONE THREAD.
 *
 * ⚠ `thread` is a FILTER, not a lookup: route keeps rows whose
 * `metadata.taskId` equals it, an id nothing carries returns `[]` not 404, and
 * any non-empty string is legal (transcripts still carry legacy
 * `task-<channelId>-<seq>` ids). Blank/whitespace treated as unset rather than
 * sent, so `thread=""` reads the channel instead of 400ing on the route's `min(1)`.
 *
 * ⚠ `await` has no thread parameter — a filtered hold would miss messages an
 * agent must follow. Never suggest a thread-scoped wait here; the agent ends up
 * armed on a call that cannot exist.
 *
 * ⚠ NEITHER SEQ IS A CURSOR, so this hint offers NO number to await from. A safe
 * `since` is the highest seq below which the reader has seen EVERYTHING
 * channel-wide; a thread-scoped read deliberately filtered rows out and
 * establishes no such bound. `await` is `gt("seq", since)`, so a LARGER `since`
 * returns FEWER messages: awaiting from the channel-wide max drops every row in
 * `(threadMax, channelMax]` permanently, since the cursor only moves forward.
 *
 * ⚠ SO A SCOPED READ PRINTS NO SEQ AT ALL (2026-08-22, Samuel's ruling). It used
 * to print `Highest seq shown: <n>` and then spend four sentences telling the
 * reader not to use `<n>` — a footgun wrapped in prose is still a footgun, and
 * the number is what survives a skim. The two options were "omit it" and "return
 * an explicitly safe `nextSince`"; the second is not available here, because the
 * only safe value is the caller's OWN prior channel-wide cursor and this op
 * cannot see it. Omitting is therefore not a lesser fix: there is no number this
 * read is entitled to hand back. ⚠ The message lines above still carry each
 * message's own `**#seq**`, so nothing is hidden — what is withheld is the
 * SUMMARY line that reads like a cursor.
 */

/**
 * THE THREAD'S OWN CARD, above the exchange (C15). ⚠ **BEST-EFFORT, AND THE
 * SILENCE IS THE CONTRACT**: a legacy `task-<channel>-<seq>` id is a real,
 * filterable `metadata.taskId` with NO row behind it, so a 404 here means "this
 * tag names no thread row", which is a fact about ad-hoc exchanges rather than
 * an error — the transcript below is the answer either way. A thrown non-404
 * still propagates.
 *
 * ⚠ It is the ONE extra round-trip on this op and it is paid only when `thread`
 * is set: an unscoped `read` is the poll-loop path and stays one call.
 */
async function threadHeader(
  client: DoplClient,
  ref: string,
  threadId: string,
  selfUserId: string | null,
): Promise<string[]> {
  let thread: ChannelThread;
  try {
    thread = await client.getChannelThread(ref, threadId);
  } catch (e) {
    if (isNotFound(e)) return [];
    throw e;
  }
  // ⚠ The roster is read only once there IS a card to put names on — an ad-hoc
  // tag pays for neither call.
  const view: MemberView = {
    selfUserId,
    names: await memberNames(client, ref),
  };
  return [formatThreadDetail(thread, view), ``];
}

export async function opRead(
  client: DoplClient,
  ref: string,
  since?: number,
  limit?: number,
  selfUserId: string | null = null,
  thread?: string,
  format?: ResponseFormat,
): Promise<ToolResponse> {
  const scope = thread?.trim() ? thread.trim() : undefined;
  // ⚠ Id ROUND TRIPS: agent copies it from a `read` legend, and a legend id is
  // `metadata.taskId`, stored verbatim by a peer for any non-UUID value. A
  // hand-built code span is not a container (one backtick opens it).
  const safeScope = scope ? inlineOr(scope, NO_ID) : "";
  // Hot path — no pre-resolve. Route accepts slug-or-id in [channelId] and
  // enforces visibility itself, so skip the per-call listChannels() round-trip.
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
  // ⚠ THE CARD IS FETCHED ONCE, BEFORE THE EMPTY BRANCH, AND IS RENDERED ON
  // BOTH (C15). An EMPTY scoped page is exactly the call whose card answers the
  // question the caller is about to ask — "is this even a thread?" — and the
  // op it replaced would have answered it.
  const card = scope ? await threadHeader(client, ref, scope, selfUserId) : [];
  const watch = `dopl_channel(op="await", channel="${ref}", since=`;
  if (messages.length === 0) {
    const sinceNote = since !== undefined ? ` after seq ${since}` : "";
    if (scope) {
      return ok(
        [
          ...card,
          `No messages tagged with thread ${safeScope} in **${ref}**${sinceNote}. \`thread\` FILTERS the transcript — an id no message carries comes back empty rather than as an error — so check the id with dopl_channel(op="list_threads", channel="${ref}") before you conclude the exchange is silent, or drop \`thread\` to read the whole channel. Watch for new messages with ${watch}${since ?? 0}); await is channel-wide and takes no thread.`,
        ].join("\n"),
      );
    }
    return ok(
      `No messages in **${ref}**${sinceNote}. Watch for new ones with ${watch}${since ?? 0}).`,
    );
  }
  const count = `${messages.length} message${messages.length === 1 ? "" : "s"}`;
  // ⚠ Banner moved to the tool DESCRIPTION (T11) — see opList.
  const lines = [
    scope
      ? `## ${ref} — ${count} in thread ${safeScope} (ONE exchange, not the whole channel)\n`
      : `## ${ref} — ${count}\n`,
  ];
  // ⚠ THE CARD GOES ABOVE THE BODIES, like every other framing on this surface:
  // a header read after the peer-typed content it describes is a header that
  // arrived too late. `memberNames` is fail-soft and is read only on this branch.
  lines.push(...card);
  // ⚠ No roster read here — hot path, the whole reason `read` skips `resolveChannelOr`.
  lines.push(...formatMessages(messages, ref, selfUserId, format));
  const lastSeq = messages[messages.length - 1].seq;
  if (!scope) {
    // A channel-wide read already IS the channel-wide cursor.
    lines.push(
      `\nHighest seq shown: ${lastSeq}. Watch for newer messages with ${watch}${lastSeq}).`,
    );
    return ok(lines.join("\n"));
  }
  // ⚠ Thread-scoped read yields NO channel-wide cursor — so it prints no
  // summary seq. See the docblock: naming the number and forbidding it in the
  // same sentence is what shipped, and the number is what got used.
  // ⚠ THE ONE SENTENCE THAT MAY NOT SHRINK TO A TOKEN. `cursor=none` alone reads
  // as "this page has no cursor yet", and the agent then takes the highest
  // `**#seq**` off a message row — which is exactly the footgun. WHY there is no
  // cursor is the whole content: a larger `since` returns FEWER messages, so a
  // seq from a FILTERED page silently and permanently drops every row the filter
  // hid. One line, and the remedy is in it.
  lines.push(
    `\ncursor=none — \`thread\` filtered rows out of this page, and \`await\` is channel-wide with a strict "greater than", so a seq taken from here would permanently skip what the filter hid. Await from the highest seq below which you have seen EVERYTHING in this channel; read unscoped to establish one.`,
  );
  return ok(lines.join("\n"));
}

/** Peer-influenced display text (a session's channel name), neutralized for a
 *  rendered result — never an empty span. */
const NO_NAME = "(unnamed)";

/**
 * READ-SESSION-STATE — the caller's OWN live sessions: handle, reduced state
 * (working / idle / ended — desktop `session-summary.js` vocabulary;
 * deliberately no "thinking", which needs streaming and streaming is off), and
 * thread. `ref` narrows to one channel; omitted = all in active workspace.
 *
 * ⚠ OWN-SCOPED is the whole security model: server read keys on the caller's
 * user id, RLS backs it, a peer's sessions never come back. Channel names and
 * thread titles are still counterparty-influenced, so they go through the same
 * inline-neutralizer under listing framing.
 *
 * Writer is `main/session-state-push.js` → `POST /api/channels/sessions`, fired
 * when the pill projection's digest moves (NOT a heartbeat).
 *
 * ⚠ The empty answer means "no live sessions being reported", never "you have
 * no sessions" — an asleep, signed-out, or older-build machine reports nothing.
 *
 * ⚠ AND THE SAME CAVEAT NOW APPLIES ROW BY ROW (2026-08-22). A row is a REPORT,
 * not an observation: nothing on the server watches the machine, so a desktop
 * that CRASHED leaves its last push standing and this op read it back as a live
 * `working` forever. `channel-session-render.ts` hedges any row quiet longer
 * than `SESSION_STALE_WINDOW_MS` into "last reported <state>" and the legend
 * says what that means. The stamp is NOT a heartbeat, so the hedge is a hedge
 * and never a claim the agent stopped.
 *
 * ⚠ THE TELEMETRY IS OPERATOR-ONLY, and this op is entitled to it because the
 * server read is own-scoped — `GET /api/channels/sessions` maps through
 * `collab-dto.ts › mapOwnSessionStateRow`. A peer's session reaches no surface
 * in this file.
 */
export async function opReadSessions(
  client: DoplClient,
  ref?: string,
  format?: ResponseFormat,
): Promise<ToolResponse> {
  // ⚠ Resolve filter to id — a slug would not match the stored channel_id.
  let channelId: string | undefined;
  let channelLabel = "";
  if (ref && ref.trim()) {
    const ch = await resolveChannelOr(client, ref.trim());
    if (isErr(ch)) return ch;
    channelId = ch.id;
    channelLabel = ` in **${inlineOr(ch.name, NO_NAME)}**`;
  }

  // ⚠ THE PAGE, NOT AN ARRAY (2026-08-23, F-294). `operatorOnline` is the
  // caller's own `agent_presence` freshness and it is what separates an
  // idle-but-alive agent from a desktop that died — the row alone cannot,
  // because the push is change-driven. ⚠ `undefined` = an older server did not
  // report it, and the render must hedge exactly as it did before.
  const { sessions, operatorOnline }: ChannelSessionsPage =
    await client.listChannelSessions(channelId);

  if (sessions.length === 0) {
    return ok(
      // ⚠ "BEING REPORTED" IS THE LOAD-BEARING PHRASE and may never become "you
      // have none": an asleep, signed-out or older machine reports nothing, so
      // an empty page is not evidence a session is not running. The rest — that
      // this is your own side only — is in the doctrine.
      `No live sessions of yours are being REPORTED${channelLabel} right now. That is not the same as having none: an asleep, signed-out or older machine reports nothing. ${DOCTRINE_POINTER}`,
    );
  }

  // ⚠ ONE `now` FOR THE WHOLE PAGE. Calling `Date.now()` per line lets two
  // sessions pushed in the same instant land on either side of the window and
  // render with different tenses, which reads as a fact about them.
  const now = Date.now();
  const anyStale = sessions.some((s) => sessionIsStale(s, now));

  // ⚠ A TABLE, AND ONLY A TABLE (T13, 2026-09-02). Banner moved to the tool
  // DESCRIPTION (T11) — see opList.
  //
  // ⚠ WHAT LEFT, AND WHY IT IS NOT A LOSS. This result used to close with three
  // standing paragraphs — the legend, SESSION_HANDLE_NOTE (~1.1k chars on how a
  // handle is spent) and SESSION_TELEMETRY_NOTE (~800) — on EVERY call, to a
  // reader who calls this op in a loop. The legend stays, because it is the one
  // that decodes THIS page's own cells and it is conditional on the page
  // actually containing a hedged row. The other two are standing DOCTRINE about
  // the surface rather than a report on these rows: they moved to
  // dopl://doctrine/channels and dopl_channel(op="help"), which is where a
  // reader who needs them can spend one call, instead of every reader paying
  // for them on every call.
  const lines = [
    `## Your sessions — ${sessions.length}${channelLabel}\n`,
    ...SESSION_TABLE_HEAD,
  ];
  for (const s of sessions) {
    // ⚠ `handle: true` — this op is own-scoped by construction (it "never shows
    // a PEER's sessions"), which is the audience question
    // {@link SessionRenderOpts.handle} asks. See it for why an agent id is not
    // published on a peer row.
    // ⚠ `concise` drops the TELEMETRY columns and nothing else. What a session
    // IS — its handle, its channel, what it is doing, whether it is stale — is
    // the answer; token spend and turn counts are metadata about it.
    lines.push(
      sessionRow(s, {
        telemetry: !isConcise(format),
        handle: true,
        now,
        operatorOnline,
      }),
    );
  }
  // ⚠ THE LEGEND STAYS AND THE POINTER IS ONE LINE. The legend decodes THIS
  // page's own cells and is conditional on the page actually containing a hedged
  // row; the standing description of the columns (which are operator-only, what
  // a `—` means, why a row is a REPORT and not an observation) is doctrine and
  // is read once, not on every call of an op an orchestrator polls in a loop.
  // ⚠ The legend decodes THIS page's own hedged cells, so it survives `concise`
  // whenever the page actually has one; the DOCTRINE_POINTER is standing
  // teaching and does not.
  lines.push(
    isConcise(format)
      ? `\n${sessionLegend(anyStale, operatorOnline)}`
      : `\n${sessionLegend(anyStale, operatorOnline)} ${DOCTRINE_POINTER}`,
  );
  return ok(lines.join("\n"));
}

export async function opListThreads(
  client: DoplClient,
  ref: string,
  selfUserId: string | null = null,
): Promise<ToolResponse> {
  // Hot-path parity with read/await: ref straight to the route (slug-or-id +
  // visibility enforced there), no pre-resolve via listChannels.
  //
  // ⚠ THE ORDER IS THE SERVER'S AND IS NOT RE-DERIVED HERE. One repository read
  // (`repository-tasks.ts › listTasksByChannel`) orders every thread list by
  // last activity, so this listing and the operator's own sidebar cannot
  // disagree about which exchange is live. Sorting these rows again would also
  // be sorting the wrong rows — the server's LIMIT clipped against ITS order.
  let threads: ChannelThread[];
  let truncated: boolean;
  try {
    ({ threads, truncated } = await client.listChannelThreads(ref));
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
    `## ${ref} — ${threads.length} thread${threads.length === 1 ? "" : "s"}, most recently active first\n`,
    // ⚠ Framing FIRST — titles/outcome summaries are peer-typed and
    // `listChannelTasks` is channel-transparent: every member receives every
    // thread's text, not just their own.
    `${UNTRUSTED_THREAD_HEADER}\n`,
  ];
  // ⚠ The clip is stated ABOVE the rows, beside what it clipped — a reader who
  // skims to the first line must not read a bounded page as the whole list.
  if (truncated) lines.push(`${threadsClippedNote(ref)}\n`);
  // Extra call, but a cold op (not the poll loop) and fail-soft — see `memberNames`.
  const view = { selfUserId, names: await memberNames(client, ref) };
  for (const t of threads) lines.push(formatThreadLine(t, view));
  // ⚠ ONE POINTER LINE (T11/T82, 2026-09-02). The pair-only WRITE RULE that used
  // to close this listing is standing doctrine — true of every thread in every
  // channel — and is stated in `channel-doctrine.ts` under THE MODEL. What stays
  // is the two calls a reader of THIS page needs next.
  lines.push(
    `\nRead one with op="read" (thread=<id>) — that returns the thread's card and its messages. ${DOCTRINE_POINTER}`,
  );
  return ok(lines.join("\n"));
}

/**
 * The channel ROSTER. Read-only; the private per-member preference (agent tool
 * profile) is scrubbed server-side for everyone but the caller and not rendered.
 *
 * ⚠ `callerIsAdmin` gates member EMAIL — a public channel is enumerable by an
 * agent that was never invited, so `formatMemberLine` shows email only for a
 * workspace admin or the caller's own row.
 */
export async function opMembers(
  client: DoplClient,
  ref: string,
  selfUserId: string | null = null,
  callerIsAdmin = false,
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
  for (const m of members)
    lines.push(formatMemberLine(m, selfUserId, callerIsAdmin));
  if (selfUserId === null) {
    // ⚠ Never guess which row is the caller — the boot handshake is the only
    // source of that id here.
    lines.push(
      `\nNo row is marked "you" — this connection could not resolve your own user id at startup.`,
    );
  }
  // ⚠ THERE USED TO BE TWO RULES HERE AND NOW THERE ARE NONE. Auto-addressing
  // keyed on `is_direct` (`resolveDirectPeer`) and the implicit trigger keyed on
  // MEMBER COUNT (`classify` in targeting.js); both retired 2026-08-18 (wiring
  // plan Phase 3). The count is still passed because the COPY names it — the
  // rule it states no longer branches on it. See `channel-addressing.ts`.
  lines.push(rosterAddressingRule(ref, members.length));
  return ok(lines.join("\n"));
}
