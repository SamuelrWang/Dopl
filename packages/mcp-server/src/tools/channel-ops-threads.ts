/**
 * `dopl_channel` THREAD op handlers: create_thread / close_thread /
 * set_thread_mode. ⚠ `channel-` filename prefix required by the parity
 * split-scan (parity.test.ts).
 *
 * ⚠ BOUNDARY: wire/storage name `task` == domain name `thread`.
 *
 * ⚠ Every string below is server NARRATION, outside untrusted framing. What is
 * peer-controlled:
 *   - `ch.name` — creator-typed, and `resolveChannelOr` resolves PUBLIC channels
 *     the caller was never invited to. 120 chars, NO charset rule, so newlines
 *     are possible. Neutralized at every site.
 *   - `thread.title` — typed by whoever OPENED the thread (200 chars, interior
 *     newlines allowed), frequently NOT the caller since a close is permitted to
 *     the thread's TARGET. Hence header AND code span on that path.
 *   - `member.label` — already render-safe: `resolveMemberOr` neutralizes at the
 *     source (`memberLabel` in channel-shared.ts). Do not re-wrap.
 */

import type { DoplClient, ThreadMode, ThreadOutcome } from "@dopl/client";
import { ok, err, isNotFound, type ToolResponse } from "./respond";
import { inlineOr, isErr, resolveChannelOr, resolveMemberOr } from "./channel-shared";
import { UNTRUSTED_THREAD_HEADER } from "./channel-render";
// ⚠ Whether a pending `await` outlives the turn is a CLIENT property this
// server cannot see — one module decides what may be claimed about it.
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
  // Caller's OBSERVED runtime stamp. Changes nothing this op does — only what
  // the result claims about waiting.
  runtime: string | null = null,
  // SPAWN-WITH-HANDOFF: declares the driving session should open on the
  // OPERATOR'S machine rather than being kept by this external session. Rides
  // the opening message's reserved `metadata.handoff` stamp; ⚠ the desktop
  // honors it only for a thread the operator created as themselves.
  handoff?: boolean,
): Promise<ToolResponse> {
  const ch = await resolveChannelOr(client, channelRef);
  if (isErr(ch)) return ch;
  const chName = inlineOr(ch.name, NO_NAME);
  const member = await resolveMemberOr(client, to);
  if (isErr(member)) return member;

  // Idempotency key goes out AS GIVEN — it carries no meaning beyond dedupe.
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
    // ⚠ Read the CODE. `to` is required here, so a bare `isBadRequest` branch
    // answers every 400 with the addressee message — an over-length title then
    // reads as "invite them first" and op="invite" answers "already a member".
    if (isBadRequest(e)) {
      switch (classifyBadRequest(e)) {
        case "addressee_not_member":
          return err(
            `Couldn't address the thread to ${member.label} — they aren't a member of **${chName}**. Invite them first (op="invite"), then open the thread.`,
          );
        // A thread is postable only by its creator and target, so a
        // self-addressed thread has nobody who can answer it and sits live and
        // unanswerable. ⚠ Name the roster op — the failure mode is not knowing
        // who else is in the channel.
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
  // ⚠ Neutralized even though the caller typed this title one argument ago:
  // deciding per site whether a string is "really" reachable is what left a
  // peer-typed title raw through a whole audit. One rule.
  const named = inlineOr(thread.title, NO_TITLE);
  // ⚠ Cursor is STATED from the route's returned opening seq, never "find the
  // newest message with read limit=1" — that costs a round-trip and races the
  // peer, whose reply becomes "the newest message" and is then awaited past.
  //
  // ⚠ HANDOFF IS A REQUEST, NOT AN OUTCOME. It is a metadata STAMP a desktop
  // listener may later act on; `session-dispatch.maybeOpenRequesterSession`
  // silently answers false when window mode is off, when `requesterTaskOpen`
  // refuses, when the window budget is spent, and (commonly) when the
  // operator's desktop is not running. No observation is available here — the
  // decision happens minutes later on another machine and never reports back.
  // So: state the request as a request, keep do-not-race as the default (two
  // watchers on one thread is a genuine failure), and give the fallback for
  // noticing that nothing picked it up. Never say "you are done" — that leaves
  // NOBODY awaiting the reply.
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
 * ⚠ `close_thread` IS NOT AN AGENT'S OP. A close settles the SHARED thread for
 * BOTH members: "the work looks done" and "I am finished with this exchange"
 * are DIFFERENT judgments, and only the human makes the second.
 *
 * ⚠ ANSWERED, NOT REMOVED — the op stays in the enum so an agent trained on the
 * old surface gets this sentence instead of a zod "invalid enum value" at the
 * moment it most needs telling what to do instead. The real gate is the
 * server's `ThreadCloseIsHumanOnlyError`, not this.
 */
export function closeThreadIsHumansToMake(): ToolResponse {
  return err(
    `Nothing was closed: closing a thread is your OPERATOR's decision, not yours. A close settles the exchange for BOTH members and takes it off the open list, and only the person you work for knows whether they are finished with it — the work being done is not the same judgment. PROPOSE it instead and they confirm: dopl_channel(op="propose_close", channel="<id>", thread="<id>", outcome="completed"|"failed", summary="<one line saying what came of it>"). That posts a marked note in the thread which surfaces to your operator as a confirmable prompt; the thread stays open and fully live until they act on it. Do not propose early. Propose once per STATE of the thread: an immediate repeat collapses into the prompt they already have, but if they keep it open and the work moves on, propose again when it is done again.`,
  );
}

/**
 * PROPOSE a close — the agent's terminal act on a thread, and the only one it
 * has (see {@link closeThreadIsHumansToMake}).
 *
 * ⚠ Proposing is allowed to the thread's CREATOR **or its TARGET**, so the
 * common shape is a peer's thread and a peer's 200-char newline-tolerant TITLE
 * rendered as our own narration. So: title is one inline code span (a value,
 * never structure), and {@link UNTRUSTED_THREAD_HEADER} comes FIRST.
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
  // ⚠ A proposal WRITES a message (a marked, NON-terminal `task_progress` the
  // operator's surfaces render as a prompt), so it MOVES the channel cursor.
  // `markerSeq` is where it landed — `openingSeq`'s mirror at the other end.
  let proposed;
  try {
    proposed = await client.proposeChannelThreadClose(ch.id, threadId, {
      outcome,
      summary,
    });
  } catch (e) {
    // ⚠ `threadId` round-trips: an agent copies it from a `read` legend, and a
    // legend id is `metadata.taskId`, peer-set verbatim for any non-UUID value.
    // A hand-built code span is not a container — one backtick opens it.
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
  // Caller's OWN summary from this very call, echoed unchanged: not peer text
  // (the stored `outcomeSummary` is neutralized by the READ ops), runs to 2000
  // chars, and neutralizing would clip the operator-facing outcome for no threat.
  const summaryNote = summary?.trim() ? ` — ${summary.trim()}` : "";
  // ⚠ THE CURSOR IS STATED, NEVER DERIVED: a guessed echo seq (last known + 1)
  // armed an await past the peer's main deliverable, which was already below
  // it. Either the number the server returned, or no seq at all.
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
      // ⚠ A proposal changes NOTHING about the thread — it stays open, routes,
      // and accepts posts whether or not anyone acts on the prompt. Claiming
      // finality makes an agent go quiet on a thread that is still live.
      `Proposed closing thread **${inlineOr(proposed.thread.title, NO_TITLE)}** in **${chName}** as ${proposed.outcome}${summaryNote}. NOTHING IS CLOSED: your operator sees this as a prompt and decides, and until they do the thread is open and fully live — it routes, it accepts posts, and a reply may still arrive. Repeating this call with nothing new said collapses into the same prompt — do not retry it idly. If the exchange CONTINUES and later concludes again, a fresh proposal is legitimate and will raise a new prompt. In the meantime, keep working the thread and answer what comes in.`,
      ...marker,
    ].join("\n"),
  );
}

/**
 * Set a thread's mode. Title neutralized as everywhere else, but ⚠ NO untrusted
 * header on purpose: the route allows `set_mode` to the thread's CREATOR only,
 * so a success means the caller typed the title — the header would frame a
 * string against its own author. The span stays anyway: a tool must not depend
 * on a remote authorization check for a LOCAL rendering property.
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
