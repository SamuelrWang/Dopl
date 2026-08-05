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

import type { DoplClient, ThreadMode, ThreadOutcome } from "@dopl/client";
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

/** Fallbacks for peer text that neutralized to nothing — never an empty span. */
const NO_NAME = "(unnamed)";
const NO_TITLE = "(untitled)";
const NO_ID = "(unreadable id)";

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
  // SPAWN-WITH-HANDOFF (rollback §3.5). When true, the create declares that the
  // driving session should open on the OPERATOR'S machine (a full requester
  // session) rather than being kept by this external session. It rides the
  // opening message's reserved `metadata.handoff` stamp; the desktop honors it
  // only for a thread the operator created as themselves.
  handoff?: boolean,
): Promise<ToolResponse> {
  const ch = await resolveChannelOr(client, channelRef);
  if (isErr(ch)) return ch;
  const chName = inlineOr(ch.name, NO_NAME);
  const member = await resolveMemberOr(client, to);
  if (isErr(member)) return member;

  // The idempotency key goes out AS GIVEN. It used to be canonicalized here:
  // a `thread-open-<channel>-<seq>` HANDSHAKE key had its channel half
  // rewritten to the resolved uuid, because a slug-built key derived no
  // participant set on the server and locked the co-addressed agent out of the
  // thread it was told to join. Nothing addresses two agents any more (channels
  // rollback §1), so the key carries no meaning beyond dedupe and there is
  // nothing to canonicalize.
  let created;
  try {
    created = await client.createChannelThread(ch.id, {
      title,
      body,
      toUserId: member.userId,
      mode,
      clientMsgId,
      handoff,
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
  // SPAWN-WITH-HANDOFF (rollback §3.5) — a create that DECLARED handoff does NOT
  // wait for the reply here: a full session opens on the operator's OWN machine
  // and carries the exchange, so telling this external session to arm `await`
  // would put two agents on one thread, each trying to consume the reply.
  //
  // F-145 — IT IS A REQUEST, AND THE COPY SAID IT WAS AN OUTCOME. This branch
  // shipped "A full session IS OPENING on your operator's Dopl app … You are
  // done", said unconditionally, off nothing but the caller's own flag. The
  // server has no evidence of any of it: the handoff is a metadata STAMP that a
  // desktop LISTENER may later act on, and `session-dispatch
  // .maybeOpenRequesterSession` answers false — silently — when window mode is
  // off, when `requesterTaskOpen` refuses, when the window budget is spent, and
  // (the common case) when the operator's desktop is not running at all. So the
  // sentence could be false in four ways, and its consequence was the worst
  // available: an agent told "you are done" leaves NOBODY awaiting the reply,
  // which is the same abandoned exchange the wake guidance exists to prevent.
  //
  // WHY THE FIX IS COPY AND NOT A CHECK. The non-handoff branch decides from the
  // OBSERVED runtime (`createThreadReplyLines`), and there is no equivalent
  // observation here: the desktop's decision happens minutes later, on another
  // machine, and never reports back. So this states the REQUEST as a request,
  // keeps the do-not-race instruction as the default (a real handoff is the
  // common case and two watchers on one thread is a genuine failure), and adds
  // the fallback the old copy denied the caller — how to notice that nothing
  // picked it up, and what to do then.
  if (handoff) {
    const since =
      created.openingSeq === null
        ? `<the seq of your opening message, from dopl_channel(op="read", channel="${ch.id}", limit=1)>`
        : String(created.openingSeq);
    return ok(
      [
        `Opened thread **${named}** in **${chName}** (thread \`${thread.id}\`, ${thread.mode} mode), addressed to ${member.label}, WITH HANDOFF.`,
        `The handoff was REQUESTED, not confirmed. The thread is stamped for your operator's Dopl app to pick up and drive; this server hands the request off and never learns whether a window opened, and the app opens none if it is not running, if session windows are off, or if its window budget is spent.`,
        `So: do NOT arm op="await" yet — if a session DID open, it owns the reply, and a second watcher here would race it for the same message. Check instead with dopl_channel(op="get_thread", channel="${ch.id}", thread="${thread.id}") — a session that took the thread shows activity on it.`,
        `IF NOTHING PICKS IT UP (no progress and no reply after a few minutes), the handoff did not land, and nobody is waiting on ${member.label}. Say so to your operator — they can open the thread in the Dopl app — or drive the exchange yourself from here with dopl_channel(op="await", channel="${ch.id}", since=${since}).`,
      ].join("\n"),
    );
  }
  const cursor =
    created.openingSeq === null
      ? `dopl_channel(op="read", channel="${ch.id}", limit=1) reports the highest seq (your request is the newest message), then call dopl_channel(op="await", channel="${ch.id}", since=<that seq>)`
      : `call dopl_channel(op="await", channel="${ch.id}", since=${created.openingSeq}) — that since is your request's own seq, so the reply is the very next message it returns`;
  return ok(
    [
      `Opened thread **${named}** in **${chName}** (thread \`${thread.id}\`, ${thread.mode} mode), addressed to ${member.label}. Thread every follow-up post with thread="${thread.id}".`,
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
 * DECISION 2 (Samuel, 2026-08-04) — `close_thread` IS NOT AN AGENT'S OP.
 *
 * THE INCIDENT'S OTHER HALF. Closing settles the SHARED thread for BOTH members,
 * and nothing linked the responder's "I am finished" to the requester's thread
 * anyway, so threads simply never closed (two are open forever in prod). The fix
 * is not to make the agent close harder: it is that "the work looks done" and "I
 * am finished with this exchange" are DIFFERENT judgments, and only the second
 * one closes anything. The human makes it.
 *
 * ANSWERED, NOT REMOVED. The op stays in the enum so this sentence is what an
 * agent trained on the old surface gets, instead of a zod "invalid enum value"
 * at the moment it most needs telling what to do instead. The gate is the
 * server's (`ThreadCloseIsHumanOnlyError`), not this.
 */
export function closeThreadIsHumansToMake(): ToolResponse {
  return err(
    `Nothing was closed: closing a thread is your OPERATOR's decision, not yours. A close settles the exchange for BOTH members and takes it off the open list, and only the person you work for knows whether they are finished with it — the work being done is not the same judgment. PROPOSE it instead and they confirm: dopl_channel(op="propose_close", channel="<id>", thread="<id>", outcome="completed"|"failed", summary="<one line saying what came of it>"). That posts a marked note in the thread which surfaces to your operator as a confirmable prompt; the thread stays open and fully live until they act on it. Do not propose early, and do not propose twice: repeats collapse into the one prompt they already have.`,
  );
}

/**
 * PROPOSE a close — the agent's terminal act on a thread, and the only one it
 * has (see {@link closeThreadIsHumansToMake}).
 *
 * It inherits the Q1 narration discipline the close had, for the same reason:
 * proposing is allowed to the thread's CREATOR **or its TARGET**, so the common
 * shape is a peer's thread, a peer's 200-character newline-tolerant TITLE, and
 * this result rendering it as our own narration. So:
 *   1. the title is one inline code span (it can be a value, never structure);
 *   2. the result carries {@link UNTRUSTED_THREAD_HEADER}, FIRST — framing that
 *      trails the content it frames is read after the injected line.
 */
export async function opProposeClose(
  client: DoplClient,
  channelRef: string,
  threadId: string,
  outcome: ThreadOutcome,
  summary?: string,
): Promise<ToolResponse> {
  const ch = await resolveChannelOr(client, channelRef);
  if (isErr(ch)) return ch;
  const chName = inlineOr(ch.name, NO_NAME);
  // `{ thread, markerSeq }` — a proposal WRITES a message (the marked, NON-
  // terminal `task_progress` the operator's surfaces render as a prompt), so it
  // moves the channel's cursor. `markerSeq` is where it landed, and it is
  // `openingSeq`'s mirror at the other end of a thread.
  let proposed;
  try {
    proposed = await client.proposeChannelThreadClose(ch.id, threadId, {
      outcome,
      summary,
    });
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
        `You can't propose a close on thread ${safeId} — only its creator or the member it's addressed to may, and nothing was posted.`,
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
  // channel below that guess. Same discipline here: the seq is either the number
  // the server actually returned, or it is not mentioned at all.
  const marker =
    proposed.markerSeq === null
      ? [
          `The proposal note did NOT post (your operator has no prompt to act on). The thread is untouched, so this is safe to retry once.`,
        ]
      : [
          `Proposal note posted at seq ${proposed.markerSeq} — if you re-arm a wait, use since=${proposed.markerSeq} (or your last READ seq), never a guessed seq.`,
        ];
  return ok(
    [
      UNTRUSTED_THREAD_HEADER,
      ``,
      // WHAT A PROPOSAL ACTUALLY DOES, in the words the product can back — the
      // same discipline F6 imposed on the close copy, which had claimed a
      // finality the server does not enforce. A proposal changes NOTHING about
      // the thread: it is open, it routes, it accepts posts, and it stays that
      // way whether or not anybody acts on the prompt. Saying so is what stops
      // an agent treating its own proposal as the end of the exchange and going
      // quiet on a thread that is still live.
      `Proposed closing thread **${inlineOr(proposed.thread.title, NO_TITLE)}** in **${chName}** as ${proposed.outcome}${summaryNote}. NOTHING IS CLOSED: your operator sees this as a prompt and decides, and until they do the thread is open and fully live — it routes, it accepts posts, and a reply may still arrive. Do not propose again; a repeat collapses into the same prompt. If more comes in, keep working the thread and answer it.`,
      ...marker,
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
