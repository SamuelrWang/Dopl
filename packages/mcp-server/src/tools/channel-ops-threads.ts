/**
 * `dopl_channel` THREAD op handlers: create_thread / close_thread /
 * set_thread_mode. Split out of `channel-ops-write.ts` at the §2 500-line cap
 * when the Q1 neutralization swept the write side; that file already carried the
 * `─── Threads ───` divider these three sat under, so the seam was drawn where
 * the module had drawn it itself. The `channel-` filename prefix is required by
 * the parity split-scan (parity.test.ts).
 *
 * BOUNDARY: the wire/storage name `task` == the domain name `thread`.
 *
 * WHAT IS PEER-CONTROLLED HERE, since every string below is server NARRATION —
 * outside any untrusted-content framing, read by the model as the tool speaking:
 *
 *   - `ch.name` — typed by whoever created the channel, and `resolveChannelOr`
 *     resolves PUBLIC channels the caller was never invited to. `schema.ts`
 *     bounds it at 120 characters with NO charset rule, so it can carry
 *     newlines. Neutralized at every site.
 *   - `thread.title` — typed by whichever member OPENED the thread, up to 200
 *     characters with interior newlines allowed. In `opCloseThread` that member
 *     is frequently NOT the caller: closing is permitted to the thread's TARGET,
 *     so my agent closing a peer's thread renders the peer's title. This is
 *     Q1-B/C arriving on the write side, and it is why close_thread carries a
 *     header as well as a code span.
 *   - `member.label` — already render-safe when it gets here; `resolveMemberOr`
 *     neutralizes it at the source (see `memberLabel` in channel-shared.ts).
 */

import type {
  DoplClient,
  ThreadMode,
  ThreadOutcome,
  ThreadParticipantRef,
} from "@dopl/client";
import { resolveParticipantSeedOr } from "./channel-agent-refs";
import { ok, err, isNotFound, type ToolResponse } from "./respond";
import { inlineOr, isErr, resolveChannelOr, resolveMemberOr } from "./channel-shared";
import { UNTRUSTED_THREAD_HEADER } from "./channel-render";
// Whether a pending `await` can outlive the turn is a CLIENT property this
// server cannot see. One module decides what may be claimed about it.
import { createThreadReplyLines } from "./channel-wake-guidance";
import {
  FIELD_CAPS_NOTE,
  classifyBadRequest,
  isBadRequest,
  isForbidden,
  serverDetail,
} from "./channel-errors";
// BLOCKER-1 — the handshake `client_msg_id` is canonicalized against the
// RESOLVED channel id before it is sent. See that module for why the teeth are
// a rewrite rather than a refusal.
import {
  malformedHandshakeKey,
  normalizeHandshakeKey,
  rewrittenHandshakeKeyNote,
} from "./channel-handshake-key";

/** Fallbacks for peer text that neutralized to nothing — never an empty span. */
const NO_NAME = "(unnamed)";
const NO_TITLE = "(untitled)";
const NO_ID = "(unreadable id)";

/**
 * S2 — `as_agent` ON `create_thread` IS REFUSED, NOT DROPPED.
 *
 * The flat input schema declares `as_agent` for the whole tool, and the
 * registrar routed it to `post` alone: passing it here did nothing, said
 * nothing, and left the caller believing its opening request was attributed to
 * its agent when the row says the bare human wrote it. Silent divergence
 * between what the surface accepts and what the code does is the exact bug
 * class this round exists to close, so it is answered rather than ignored.
 *
 * REFUSE rather than wire it through, because the attribution is not the only
 * thing that would change. `TaskCreateSchema` carries no `authorAgentId`, so
 * wiring it is server work — and the receiving desktop classifies an
 * agent-authored message addressed to a PERSON with no addressed agent as
 * `agent-escalation`, a notification that deliberately spawns nothing
 * (dopl-desktop-app/main/targeting.js). An agent-attributed opening request
 * would therefore stop starting the responder's side, which is the one thing
 * create_thread exists to do. The refusal costs one retry; wiring it would cost
 * the op its purpose.
 */
export function asAgentNotOnCreateThread(): ToolResponse {
  return err(
    `create_thread does not take \`as_agent\` — nothing was created. A thread's OPENING message is your operator's request, not your agent's: it is what starts the responder's side, and an agent-attributed message addressed to a person is treated as a NOTIFICATION there rather than a request, so attributing this one would stop the thread waking anybody. Open the thread without \`as_agent\`, then post as yourself inside it: dopl_channel(op="post", thread="<the new thread id>", as_agent="<your handle>", body="...").`,
  );
}

export async function opCreateThread(
  client: DoplClient,
  channelRef: string,
  title: string,
  body: string,
  to: string,
  mode?: ThreadMode,
  clientMsgId?: string,
  // The caller's OBSERVED runtime stamp (`CallerIdentity.runtime`). Changes
  // nothing this op does — only what the result claims about waiting.
  runtime: string | null = null,
  /**
   * MULTIPLAYER — the EXTRA identities admitted to the thread, in the prefix
   * form `agent:<handle>` / `user:<email>` (see `channel-agent-refs.ts`).
   * Passing any of them is what makes this a BREAKOUT ROOM: the participant
   * set then decides who may post, instead of the creator/target pair. Last
   * positional on purpose — every existing call site keeps its shape.
   */
  participants?: string[],
): Promise<ToolResponse> {
  const ch = await resolveChannelOr(client, channelRef);
  if (isErr(ch)) return ch;
  const chName = inlineOr(ch.name, NO_NAME);
  const member = await resolveMemberOr(client, to);
  if (isErr(member)) return member;

  // BLOCKER-1 — the handshake key, anchored on the id the SERVER will parse.
  // This op resolved slug-or-id one call ago, so it holds the uuid the agent
  // was told to put here and may not have had; a key built from the slug
  // derives no participant set and locks the co-addressed agent out of the
  // thread it was told to join, silently and on the OTHER machine. Refused
  // only when there is nothing to repair (no `<seq>` tail).
  const handshake = normalizeHandshakeKey(clientMsgId, ch.id);
  if (handshake.status === "malformed") {
    return err(malformedHandshakeKey(clientMsgId as string, ch.id));
  }
  const sentMsgId =
    handshake.status === "ok" ? handshake.key : clientMsgId;

  // Resolved BEFORE the create: a bad participant must not leave a live thread
  // behind. The server seeds its set before the opening post for the same
  // reason — a half-built room would judge its own first message.
  let seed: ThreadParticipantRef[] = [];
  if (participants && participants.length > 0) {
    const resolved = await resolveParticipantSeedOr(client, ch.id, participants);
    if (isErr(resolved)) return resolved;
    seed = resolved;
  }

  let created;
  try {
    created = await client.createChannelThread(ch.id, {
      title,
      body,
      toUserId: member.userId,
      mode,
      clientMsgId: sentMsgId,
      participants: seed.length > 0 ? seed : undefined,
    });
  } catch (e) {
    // Q9 — `to` is REQUIRED for create_thread, so the old bare `isBadRequest`
    // branch answered every 400 with the addressee message and had no
    // fall-through at all: a 240-character title (rejected by the route's own
    // zod schema, before `createTask` ran) came back as "invite them first",
    // and op="invite" then answered "already a member". Read the code.
    if (isBadRequest(e)) {
      switch (classifyBadRequest(e)) {
        case "addressee_not_member":
          return err(
            `Couldn't address the thread to ${member.label} — they aren't a member of **${chName}**. Invite them first (op="invite"), then open the thread.`,
          );
        // A thread can only ever be posted into by its creator and its target,
        // so addressing one to yourself leaves nobody who can answer it. The
        // shape that produced this in the wild: a session holding TWO dopl
        // connections resolved `to` back to its own operator, and the thread
        // sat live and unanswerable until a human noticed. Naming the roster op
        // matters — the failure mode is not knowing who else is in the channel.
        case "self_target":
          return err(
            `A thread can't be addressed to yourself — you and the member you address it to are the only two who may post into it, so a self-addressed thread has nobody who can answer it. No thread was opened. List the channel's other members (op="members", channel="${ch.id}"), then open the thread addressed to one of them.`,
          );
        case "invalid_request":
          return err(
            `That create_thread was rejected as INVALID before it reached **${chName}** — no thread was opened, and this is NOT a membership problem, so do NOT invite ${member.label}.${serverDetail(e)} ${FIELD_CAPS_NOTE} Shorten the field that is over and open the thread again.`,
          );
        // B2 — THE TWO 400s THAT CAN ARRIVE WITH A LIVE THREAD BEHIND THEM.
        // `createTask` inserts the thread row FIRST, then seeds the participant
        // set, then posts the opening message (the ordering is deliberate: the
        // opening post runs the thread-write gate, which reads the set). So a
        // participant the route refuses fails AFTER the insert, and the thread
        // exists — titled, empty, and unanswerable until somebody notices.
        // Saying "no thread was opened" here was false twice over, and a blind
        // retry with the same `client_msg_id` short-circuits on the stored row
        // and never repairs the set, so the caller has to LOOK before retrying.
        // The MCP side now resolves both halves against this channel's own
        // rosters (`channel-agent-refs.ts`), so this arm is the residue: a
        // membership that changed between the resolve and the call, or a route
        // rule this tool does not mirror.
        case "participant_not_member":
        case "agent_not_in_channel":
          return err(
            `The thread's PARTICIPANT SET was rejected: one of the identities you named does not belong to **${chName}**.${serverDetail(e)} A participant must already be in the channel — a person as a MEMBER (op="members"), an agent as an agent OF THIS CHANNEL (op="agents"). A THREAD MAY HAVE BEEN OPENED ANYWAY, with no request in it: the row is inserted BEFORE the set is seeded, so DO NOT retry blind — check dopl_channel(op="list_threads", channel="${ch.id}") first. If the thread is there, repair it in place: admit the identity with op="join_thread" (once it really belongs to the channel), then post the request into it with thread="<that id>". Re-sending create_thread with the same client_msg_id returns that same thread and re-posts the opening request, but it does NOT re-seed the participant set; sending it with a NEW client_msg_id (or none) opens a SECOND thread for the same work.`,
          );
        case "workspace":
          return err(
            `The thread was not opened because the call carried no usable workspace.${serverDetail(e)} This is a connection-level problem, not a channel one — report it to your operator.`,
          );
        case "thread_not_in_channel":
        case "unknown":
          return err(
            `Opening the thread in **${chName}** was rejected (HTTP 400) and the server did not name a cause this tool recognizes.${serverDetail(e)} No thread was opened.`,
          );
      }
    }
    throw e;
  }
  const thread = created.thread;
  // The title here is the caller's OWN — they typed it one argument ago, and the
  // route stores it verbatim — so this echo tells them nothing they did not
  // write. It is neutralized regardless, and NOT because the value is suspect:
  // deciding per site whether a string is "really" reachable is exactly the
  // reasoning that left close_thread raw through a whole audit. One rule.
  const named = inlineOr(thread.title, NO_TITLE);
  // WAKE-V1 teaching: the requester's own session is what has to come back for
  // the responder's answer. WHETHER a pending await does that — or whether the
  // session is fed the reply as a turn instead — is decided in
  // `channel-wake-guidance.ts` from the caller's observed runtime; it used to be
  // promised here unconditionally, and falsely for an external session. The
  // route hands back the opening message's seq, so the cursor is stated
  // OUTRIGHT — the older text told the agent to go find it with `read limit=1`,
  // which cost a round-trip and raced the peer (a reply landing in between
  // becomes "the newest message", and the await then starts past it).
  const cursor =
    created.openingSeq === null
      ? `dopl_channel(op="read", channel="${ch.id}", limit=1) reports the highest seq (your request is the newest message), then call dopl_channel(op="await", channel="${ch.id}", since=<that seq>)`
      : `call dopl_channel(op="await", channel="${ch.id}", since=${created.openingSeq}) — that since is your request's own seq, so the reply is the very next message it returns`;
  // The set is reported as a COUNT plus what it means, not as a roster: the
  // caller just named these identities itself, and the authoritative set (with
  // the server's own seeded creator/target rows) is what op="get_thread"
  // renders. Saying it at all matters — a breakout room and an ordinary thread
  // are governed by different rules, and nothing else on this line says which.
  const breakout =
    seed.length > 0
      ? [
          `BREAKOUT ROOM: ${seed.length} extra participant${seed.length === 1 ? "" : "s"} admitted alongside you and ${member.label}. Its participant set — not the creator/target pair — is now who may post into it; see it with dopl_channel(op="get_thread", channel="${ch.id}", thread="${thread.id}"). Agents in the set still act only when ADDRESSED.`,
        ]
      : [];
  // BLOCKER-1 — a rewritten key is REPORTED, never silent. An idempotency key
  // the tool changed under the caller is exactly the kind of helpfulness that
  // has to be visible: the agent has to mint the same string next turn, and a
  // silent repair teaches it nothing.
  const keyNote =
    handshake.status === "ok" && handshake.rewritten
      ? [rewrittenHandshakeKeyNote(clientMsgId as string, handshake.key)]
      : [];
  return ok(
    [
      `Opened thread **${named}** in **${chName}** (thread \`${thread.id}\`, ${thread.mode} mode), addressed to ${member.label}. Thread every follow-up post with thread="${thread.id}".`,
      ...keyNote,
      ...breakout,
      ...createThreadReplyLines(
        cursor,
        member.label,
        runtime,
        `Keep re-arming while the exchange is alive; ${member.label}'s agent may work for a long stretch before answering. Every ~3 empty holds, check first: dopl_channel(op="get_thread", channel="${ch.id}", thread="${thread.id}") for status, and op="read" for progress milestones. STOP and report to your operator when the thread is closed or failed, or when nothing at all has come from them for ~30+ minutes.`,
      ),
    ].join("\n"),
  );
}

/**
 * Close a thread — the write op the Q1 completeness review caught still raw.
 *
 * Closing is allowed to the thread's CREATOR **or its TARGET**, so the common
 * shape is: a peer opens a thread, titles it, addresses it to me; my agent does
 * the work and closes it; and the close echo renders the PEER's 200-character,
 * newline-tolerant title as our own narration. That is Q1-B/C's exact defect
 * class on a surface the first pass never enumerated, and it is not a read an
 * agent chose — it is the confirmation of an action it just took.
 *
 * Two changes, both of them the ones the read ops got:
 *   1. the title is one inline code span (it can be a value, never structure);
 *   2. the result carries {@link UNTRUSTED_THREAD_HEADER}, FIRST — framing that
 *      trails the content it frames is read after the injected line.
 */
export async function opCloseThread(
  client: DoplClient,
  channelRef: string,
  threadId: string,
  outcome: ThreadOutcome,
  summary?: string,
): Promise<ToolResponse> {
  const ch = await resolveChannelOr(client, channelRef);
  if (isErr(ch)) return ch;
  const chName = inlineOr(ch.name, NO_NAME);
  // `{ thread, echoSeq }` — closing WRITES a message (the task_finished /
  // task_failed marker), so it moves the channel's cursor. `echoSeq` is where
  // it landed, and it is `openingSeq`'s mirror at the other end of a thread.
  let closed;
  try {
    closed = await client.closeChannelThread(ch.id, threadId, { outcome, summary });
  } catch (e) {
    // `threadId` is the caller's own argument, but it round-trips: an agent
    // copies a thread id out of a `read` legend, and a legend id is
    // `metadata.taskId`, which a peer sets verbatim for any non-UUID value
    // (Q1-E). Neutralized on the way back out for that reason — a hand-built
    // code span is not a container, and one backtick in the value opens it.
    const safeId = inlineOr(threadId, NO_ID);
    if (isNotFound(e)) {
      return err(`No thread ${safeId} in **${chName}**.`);
    }
    if (isForbidden(e)) {
      return err(
        `You can't close thread ${safeId} — only its creator or the member it's addressed to may close it.`,
      );
    }
    throw e;
  }
  // The caller's OWN summary, from this very call, echoed back unchanged and
  // deliberately: it is not peer text (nothing round-trips it — the stored
  // `outcomeSummary` is rendered by the READ ops, where it is neutralized), it
  // runs to 2000 characters, and it is legitimately prose the agent just wrote.
  // Neutralizing it would clip and de-punctuate the operator-facing outcome for
  // no threat — an agent cannot inject itself.
  const summaryNote = summary?.trim() ? ` — ${summary.trim()}` : "";
  // THE CURSOR, STATED — never derived. Live incident: a requester closed a
  // thread, GUESSED the echo's seq (last known + 1), armed `await` one past it,
  // and silently skipped the peer's main deliverable, which was already in the
  // channel below that guess. So the seq is either reported as the number the
  // server actually returned, or not mentioned at all: `echoSeq` is null when
  // the server sent no field (an older deployment) or the marker post failed,
  // and in both cases a guess here would be the same bug with our name on it.
  const echo =
    closed.echoSeq === null
      ? []
      : [
          `Close echo posted at seq ${closed.echoSeq} — if you re-arm a wait, use since=${closed.echoSeq} (or your last READ seq), never a guessed seq.`,
        ];
  return ok(
    [
      UNTRUSTED_THREAD_HEADER,
      ``,
      // F6 — WHAT A CLOSE ACTUALLY DOES, said in the words the product can back.
      // This line read "Closed thread <title> … as <outcome>." full stop, which
      // is finality the server does not enforce: the post path gates on thread
      // membership and never on status, so a closed thread goes on accepting
      // posts (five landed in one live run, silently). Rather than make the
      // sentence true with a 403 — which would break the legitimate "one last
      // word after the close echo" pattern, and would point at a `reopen` this
      // tool does not have — the copy says what closing changes.
      //
      // AND IT IS THE PASSIVE LANE ONLY. The first cut overshot in the other
      // direction ("no session is woken for it any more"): the desktop skips the
      // passive thread-lane wake for a closed thread off a status cache that
      // lags by up to ~5 minutes, an older build does not skip it at all, and an
      // ADDRESSED post starts the addressee whatever the thread's status is. A
      // close is a signal to the room, not a lock on it. A late post is warned,
      // not refused (`closedThreadNote`, channel-post-linkage.ts).
      `Closed thread **${inlineOr(closed.thread.title, NO_TITLE)}** in **${chName}** as ${closed.thread.outcome}${summaryNote}. Closing records the OUTCOME and stops the thread's PASSIVE routing: peers' sessions stop being woken by activity in it, and it is off the open list. It does NOT seal it: the thread still accepts posts (a late one lands on the card and comes back with a warning), and an agent you address directly still hears you. Say any final word now; start anything NEW in its own thread. Reopening is a human's action in the web app.`,
      ...echo,
    ].join("\n"),
  );
}

/**
 * Set a thread's mode. The title renders here too, and it is neutralized on the
 * same rule as everywhere else — but this op gets NO untrusted header, on
 * purpose: the route allows `set_mode` to the thread's CREATOR only, so a
 * successful call means the caller typed the title itself. The span is kept
 * anyway (a tool must not depend on a remote authorization check for a LOCAL
 * rendering property), while the header would be framing a string against its
 * own author.
 */
export async function opSetThreadMode(
  client: DoplClient,
  channelRef: string,
  threadId: string,
  mode: ThreadMode,
): Promise<ToolResponse> {
  const ch = await resolveChannelOr(client, channelRef);
  if (isErr(ch)) return ch;
  const chName = inlineOr(ch.name, NO_NAME);
  let thread;
  try {
    thread = await client.setChannelThreadMode(ch.id, threadId, { mode });
  } catch (e) {
    const safeId = inlineOr(threadId, NO_ID);
    if (isNotFound(e)) {
      return err(`No thread ${safeId} in **${chName}**.`);
    }
    if (isForbidden(e)) {
      return err(
        `You can't change the mode of thread ${safeId} — only its creator can.`,
      );
    }
    throw e;
  }
  return ok(
    `Set thread **${inlineOr(thread.title, NO_TITLE)}** in **${chName}** to ${thread.mode} mode.`,
  );
}
