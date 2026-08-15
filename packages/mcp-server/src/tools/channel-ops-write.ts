/**
 * `dopl_channel` op="post" — send a message or a structured activity event.
 * Resolve the addressing, make the call, map the 4xx, hand the outcome to the
 * modules that narrate it.
 *
 * ⚠ BOUNDARY: wire/storage name `task` == domain name `thread`. The `thread` op
 * param folds into `metadata.taskId` and `task_*` kinds keep their stored
 * names; only the agent-facing surface says `thread`.
 *
 * ⚠ PEER-CONTROLLED TEXT. Every string below is server NARRATION with no
 * untrusted framing, and two peer-authored values splice into it:
 *   - `ch.name` — `resolveChannelOr` lists PUBLIC channels the caller was never
 *     invited to, so the name can come from someone the agent never contacted.
 *   - `toLabel` (`profiles.display_name`) — already render-safe:
 *     `resolveMemberOr` neutralizes at the source. ⚠ Do NOT neutralize twice.
 *
 * ⚠ A post addresses a PERSON or nobody; `intent` decides whether even that
 * reaches their machine. There is no agent-addressing param.
 */

import type {
  ChannelMessageInput,
  DoplClient,
  MessageIntent,
} from "@dopl/client";
import { ok, err, type ToolResponse } from "./respond";
// "Did it thread?" — the question a sender cannot otherwise settle.
import { closedThreadNote, threadLinkageNote } from "./channel-post-linkage";
// "What did the ADDRESSING do?" — conflict note + addressed/chat/unaddressed line.
import {
  CHAT_ADDRESSED_REFUSAL,
  postAddressLines,
} from "./channel-post-notes";
import {
  inlineOr,
  isErr,
  metaString,
  resolveChannelOr,
  resolveMemberOr,
} from "./channel-shared";
// ⚠ Whether a pending `await` outlives the turn is a CLIENT property this
// server cannot see — one module decides what may be claimed about it.
import { postReplyLines } from "./channel-wake-guidance";
// ⚠ A 400's MEANING is read off its CODE, never guessed from its status.
import {
  FIELD_CAPS_NOTE,
  classifyBadRequest,
  classifyForbidden,
  isBadRequest,
  isForbidden,
  serverDetail,
} from "./channel-errors";

/** Fallback for peer text that neutralized to nothing — never an empty span. */
const NO_NAME = "(unnamed)";

/**
 * THE THREE KINDS AN AGENT MAY NOT POST — fast half of a refusal the server
 * also makes (`service-writes.assertLifecycleKindIsServerOwned`). Duplicated
 * here so the refusal can say WHAT TO DO INSTEAD before anything is sent, which
 * makes "nothing was sent" trivially true.
 *
 * ⚠ `task_progress` is deliberately absent — the milestone lane stays writable.
 */
const LIFECYCLE_KINDS: ReadonlySet<string> = new Set([
  "task_started",
  "task_finished",
  "task_failed",
]);

/**
 * ⚠ Leads with the CONSEQUENCE, not the rule: an agent reaching for
 * `task_finished` believes it is delivering, so "the body is not rendered" is
 * the sentence that changes behaviour, not "that kind is reserved".
 */
function lifecycleKindRefusal(kind: string): ToolResponse {
  return err(
    `Nothing was sent: \`kind="${kind}"\` is a LIFECYCLE MARKER, not a way to say something, and it is not yours to post. Those three kinds ("task_started" / "task_finished" / "task_failed") are written by the runtime that starts and stops a session and by a thread close, and the other member's thread card renders a terminal marker as a STATUS CHIP — its body is not shown at all, so an answer sent this way is delivered nowhere. Re-send it as an ordinary message: drop \`kind\` entirely and post the same text. Everything substantive you send, your FINAL ANSWER included, is a plain message. To mark that a step LANDED, that is dopl_channel(op="milestone", thread="<id>", body="<one line>") — a marker, not a delivery.`,
  );
}

/** Options accepted by opPost — the per-post flags routed from the registrar. */
interface PostOptions {
  kind?: ChannelMessageInput["kind"];
  metadata?: Record<string, unknown>;
  clientMsgId?: string;
  /** Address the post to one member (email or user id, resolved like invite). */
  to?: string;
  /** One-line intent for the receiver's notification. */
  summary?: string;
  /** A thread id — threads this post under that thread's card (server-validated). */
  thread?: string;
  /**
   * CHAT vs REQUEST — whether this post may reach the addressee's machine.
   * Absent = `request`: `to` addresses and a DIRECT channel's auto-address
   * fires. `chat` skips the auto-address server-side.
   *
   * ⚠ `chat` beside a `to` is a CONTRADICTION, refused here before the call
   * (see {@link CHAT_ADDRESSED_REFUSAL}) and by the route as
   * `CHANNEL_CHAT_ADDRESSED`.
   */
  intent?: MessageIntent;
  /**
   * Caller's OBSERVED runtime stamp (`CallerIdentity.runtime`). Changes nothing
   * this op does — only what the result may claim about waiting for the reply.
   */
  runtime?: string | null;
}

export async function opPost(
  client: DoplClient,
  channelRef: string,
  body: string,
  opts: PostOptions = {},
): Promise<ToolResponse> {
  // ⚠ Both refusals stay BEFORE any round-trip: a post this tool will not make
  // needs nothing resolved, so "nothing was sent" is trivially true and cannot
  // be confused with a delivery failure.
  if (opts.intent === "chat" && opts.to) {
    return err(CHAT_ADDRESSED_REFUSAL);
  }
  if (opts.kind && LIFECYCLE_KINDS.has(opts.kind)) {
    return lifecycleKindRefusal(opts.kind);
  }
  const ch = await resolveChannelOr(client, channelRef);
  if (isErr(ch)) return ch;
  const chName = inlineOr(ch.name, NO_NAME);

  // Resolve addressee (email or user id) to a workspace member, like invite
  // does; the route then enforces channel membership.
  let toUserId: string | undefined;
  let toLabel: string | undefined;
  if (opts.to) {
    const member = await resolveMemberOr(client, opts.to);
    if (isErr(member)) return member;
    toUserId = member.userId;
    toLabel = member.label;
  }

  // Fold `thread` into the STORAGE key `metadata.taskId`; explicit param wins
  // over any metadata copy. Route validates it resolves in this channel.
  const metadata = opts.thread
    ? { ...(opts.metadata ?? {}), taskId: opts.thread }
    : opts.metadata;

  let message;
  try {
    message = await client.postChannelMessage(ch.id, {
      body,
      kind: opts.kind,
      metadata,
      clientMsgId: opts.clientMsgId,
      toUserId,
      summary: opts.summary,
      // ⚠ Omitted `intent` means `request` and stamps NO metadata key
      // (service-writes-metadata.ts).
      intent: opts.intent,
    });
  } catch (e) {
    // ⚠ Map 400s off the CODE, never off which params happened to be set —
    // param-guessing misreads a rejected BODY (>16000-char body, >200-char
    // summary) as a membership problem and sends the agent to invite someone.
    if (isBadRequest(e)) {
      switch (classifyBadRequest(e)) {
        case "addressee_not_member":
          return err(
            `Couldn't address the message to ${toLabel ?? "that member"} — they aren't a member of **${chName}**. Invite them first (op="invite"), or post without \`to\`.`,
          );
        case "thread_not_in_channel":
          return err(
            `That thread is not in this channel — check the thread id, or post without \`thread\`.`,
          );
        case "invalid_request":
          return err(
            `That post was rejected as INVALID before it reached **${chName}** — nothing was sent, and this is NOT a membership or thread problem, so do not invite anyone or change \`thread\` over it.${serverDetail(e)} ${FIELD_CAPS_NOTE} Shorten the field that is over and post again.`,
          );
        case "workspace":
          return err(
            `The post was rejected because the call carried no usable workspace.${serverDetail(e)} This is a connection-level problem, not a channel one — report it to your operator.`,
          );
        // Local guard above already refuses this pair, so reaching here means
        // the two disagree — answer with the RULE.
        case "chat_addressed":
          return err(CHAT_ADDRESSED_REFUSAL);
        // `self_target` is create_thread-only (`post to=self` is deliberately
        // NOT guarded server-side), so this arm is unreachable and exists only
        // to keep the switch exhaustive.
        case "self_target":
        case "unknown":
          return err(
            `The post to **${chName}** was rejected (HTTP 400) and the server did not name a cause this tool recognizes.${serverDetail(e)} Nothing was sent.`,
          );
      }
    }
    // ⚠ 403s told apart by CODE, not by which params happened to be set.
    if (isForbidden(e)) {
      const kind = classifyForbidden(e);
      // Server refused the kind. Unreachable behind the guard at the top of
      // this op; answered with the same sentence rather than an arm that talks
      // about channel membership.
      if (kind === "lifecycle_kind") {
        return lifecycleKindRefusal(opts.kind ?? "task_finished");
      }
      if (opts.thread && kind !== "not_a_member") {
        // A thread belongs to its CREATOR and its addressee; that pair is the
        // whole write gate.
        //
        // ⚠ The thread id is NOT echoed here. It round-trips (an agent copies
        // it from a `read` legend = `metadata.taskId`, peer-set verbatim for
        // non-UUID values), and "the id you just passed" needs no escaping.
        return err(
          `You can't post into that thread — nothing was posted. A thread is between the member who OPENED it and the member it is addressed TO, and you are neither: check it with dopl_channel(op="get_thread", channel="${ch.id}", thread=<the id you just passed>). Post into the channel instead, or ask one of those two to open a thread with you. Do NOT open your own thread for the same work; that is a duplicate room, not a way in.`,
        );
      }
      if (kind === "not_a_member") {
        return err(
          `You can't post to **${chName}** — you are not a member of that channel. Nothing was posted.`,
        );
      }
    }
    throw e;
  }

  const kindNote = message.kind !== "message" ? `, kind ${message.kind}` : "";
  // ⚠ `toLabel` is already render-safe from its resolver — do not re-wrap.
  const toNote = toLabel ? `, addressed to ${toLabel}` : "";
  // ⚠ `landedThread` read back off the STORED message: what actually landed,
  // not what was asked for.
  const addressLines = postAddressLines({
    channelId: ch.id,
    safeChannelName: chName,
    isDirect: ch.isDirect,
    intent: opts.intent,
    toLabel,
    landedThread: metaString(message, "taskId"),
  });
  // Second line under the confirmation — a sender cannot otherwise tell
  // continuation from new request, and the tag drop it catches is silent.
  const linkage = await threadLinkageNote(
    client,
    ch.id,
    chName,
    message,
    // ⚠ The caller named a thread if EITHER argument carried one. `metadata` is
    // a caller-settable passthrough whose schema description tells agents to
    // put `taskId` in it, and it is forwarded untouched when `thread` is
    // absent — reading `opts.thread` alone makes such a post look unthreaded
    // and produces a false "you named no thread" claim.
    opts.thread ??
      (typeof opts.metadata?.taskId === "string" && opts.metadata.taskId.trim()
        ? opts.metadata.taskId
        : undefined),
  );
  return ok(
    [
      `Posted to **${chName}** (message \`${message.id}\`, seq ${message.seq}${kindNote}${toNote}). Readers watching with op="await" will pick it up.`,
      ...addressLines,
      ...(linkage ? [linkage] : []),
      // ⚠ Read off the SERVER's answer, never guessed. A closed thread still
      // ACCEPTS the post — warn, never refuse: a 403 breaks the legitimate
      // final-word-after-the-close-echo pattern.
      ...(message.threadClosed ? [closedThreadNote(ch.id)] : []),
      // ⚠ Whether the await outlives this turn is `channel-wake-guidance.ts`'s
      // to assert, off the caller's observed runtime — never promise it here.
      //
      // Stop rule rides with it: "re-arm on timeout" with no exit loops forever
      // over an abandoned exchange, but a plain timeout COUNTER abandons a peer
      // legitimately heads-down for 20+ minutes. The exit is the THREAD's state.
      ...postReplyLines(
        ch.id,
        message.seq,
        opts.runtime ?? null,
        `Keep re-arming while the exchange is alive; an agent working a real task can be quiet for a long stretch. Every ~3 empty holds, check first (op="read" for new activity — a working agent posts task_progress as it goes; op="get_thread" for status). Judge that on the member you addressed alone: in a channel with others, their traffic is not evidence YOUR exchange is alive. STOP and report to your operator when the thread is closed or failed, or when nothing has come from that member for ~30+ minutes.`,
      ),
    ].join("\n"),
  );
}

