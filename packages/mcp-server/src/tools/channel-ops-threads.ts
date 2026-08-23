/**
 * `dopl_channel` THREAD op handlers: create_thread / set_thread_mode.
 * ⚠ `channel-` filename prefix required by the parity split-scan
 * (parity.test.ts).
 *
 * ⚠ BOUNDARY: wire/storage name `task` == domain name `thread`.
 *
 * ⚠ Every string below is server NARRATION, outside untrusted framing. What is
 * peer-controlled:
 *   - `ch.name` — creator-typed, and `resolveChannelOr` resolves PUBLIC channels
 *     the caller was never invited to. 120 chars, NO charset rule, so newlines
 *     are possible. Neutralized at every site.
 *   - `thread.title` — typed by whoever OPENED the thread (200 chars, interior
 *     newlines allowed), and NOT necessarily the caller on every path. Hence
 *     header AND code span wherever it is rendered.
 *   - `member.label` — already render-safe: `resolveMemberOr` neutralizes at the
 *     source (`memberLabel` in channel-shared.ts). Do not re-wrap.
 */

import type { DoplClient, ThreadMode } from "@dopl/client";
import { ok, err, isNotFound, type ToolResponse } from "./respond";
import { inlineOr, isErr, resolveChannelOr, resolveMemberOr } from "./channel-shared";
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
  // refuses, when the concurrency ceiling is spent, and (commonly) when the
  // operator's desktop is not running.
  //
  // ⚠ **AND SINCE F-228 THE ANSWER IS ALWAYS "NOTHING OPENED" (F-274,
  // 2026-08-22).** `main/targeting.js › requesterTaskOpen` — the predicate that
  // consumed the stamp — has NO CALLER; its listener path died with the session
  // window. The server half still works perfectly and the last layer is missing,
  // which is the shape that produces the most confident wrong copy.
  //
  // ⚠ THE OLD COPY'S OPERATIVE INSTRUCTION WAS "do NOT arm op=await yet", AND
  // THAT IS WHAT MADE IT A DEFECT RATHER THAN AN OVERSTATEMENT: an external
  // session did exactly that, nothing opened, and NOBODY watched the thread —
  // the counterparty's reply landing to no one, silently, on both sides. So the
  // block now says the flag changed nothing, tells the caller to arm the wait
  // ITSELF, and points at `op="launch_agent"` for the capability that is real.
  if (handoff) {
    const since =
      created.openingSeq === null
        ? `<the seq of your opening message, from dopl_channel(op="read", channel="${ch.id}", limit=1)>`
        : String(created.openingSeq);
    return ok(
      [
        `Opened thread **${named}** in **${chName}** (thread \`${thread.id}\`, ${thread.mode} mode), addressed to ${member.label}. \`handoff\` was set and it CHANGED NOTHING.`,
        `⚠ THE HANDOFF LANE OPENS NOTHING TODAY (F-274). The flag is still accepted and still stamped on the thread, but no current Dopl app reads that stamp — the reader was removed with the session window — so this thread behaves exactly as it would have without the flag: **nothing started on your operator's machine, and THIS session still owns the reply.**`,
        `So YOU are the one waiting on ${member.label}, and you must arm the wait yourself: dopl_channel(op="await", channel="${ch.id}", since=${since}). ⚠ Do NOT skip that on the assumption a session took over — if you end your turn here, NOBODY is watching this thread and ${member.label}'s reply will be read by no one.`,
        `IF WHAT YOU WANTED WAS AN AGENT RUNNING ON YOUR OPERATOR'S MACHINE, that is a different call and it exists: dopl_channel(op="launch_agent", channel="${ch.id}", thread="${thread.id}", goal="..."). It ASKS the machine, waits briefly, and tells you what it said — including if your operator has that turned off.`,
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
        `Keep re-arming while the exchange is alive; ${member.label}'s agent may work for a long stretch before answering. Every ~3 empty holds, check first with op="read" for progress milestones. STOP and report to your operator when nothing at all has come from that member for ~30+ minutes. There is no finished STATE to wait for — a thread never closes — so silence from the member you addressed is the only stop signal there is.`,
      ),
    ].join("\n"),
  );
}

/**
 * ⚠ TWO OPS ENDED HERE with thread closing (wiring plan Phase 4, 2026-08-18):
 *
 *  - `closeThreadIsHumansToMake()` — the teaching refusal for `close_thread`.
 *    It was ANSWERED rather than removed from the enum, so an agent trained on
 *    the old surface got a sentence telling it what to do instead of a zod
 *    "invalid enum value". That trade only pays while there IS something to do
 *    instead; there is not, and the words themselves now teach a feature that
 *    does not exist, so the op left the enum too.
 *  - `opProposeClose()` — the agent's terminal act, a marked non-terminal
 *    `task_progress` its operator confirmed. Nothing to confirm.
 *
 * The rendering rules they demonstrated are still the file's: a peer-typed TITLE
 * goes in one inline code span with `channel-render.ts`'s
 * `UNTRUSTED_THREAD_HEADER` FIRST, and a returned cursor is STATED from the
 * server's own seq, never guessed. ⚠ Nothing left here renders a title the
 * caller did not just type, so the header has no site in this file today.
 */

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
