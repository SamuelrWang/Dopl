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
// ⚠ THE RESULT IS ONE LINE OF FACTS (T10/T12). Each import below contributes
// FIELDS, not prose; the standing rules they used to restate live once in
// `channel-doctrine.ts`, behind `op="help"`.
import { factsLine, type FactValue } from "./channel-facts";
// "Did it thread?" — the question a sender cannot otherwise settle.
import { threadFacts } from "./channel-post-linkage";
// The one refusal that is not a fact about a successful write.
import { CHAT_ADDRESSED_REFUSAL } from "./channel-post-notes";
// "What became of the `@…` tokens?" — the server's own resolution, read back.
import { postMentionFacts } from "./channel-post-guidance";
import {
  inlineOr,
  isErr,
  resolveChannelOr,
  resolveMemberOr,
} from "./channel-shared";
// ⚠ Whether a pending `await` outlives the turn is a CLIENT property this
// server cannot see — one module decides what may be claimed about it.
import { awaitFact } from "./channel-wake-guidance";
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
    `Nothing was sent: \`kind="${kind}"\` is a LIFECYCLE MARKER, not a way to say something, and it is not yours to post. Those three kinds ("task_started" / "task_finished" / "task_failed") are written by the runtime that starts and stops a session, and the other member's thread card renders a terminal marker as a STATUS CHIP — its body is not shown at all, so an answer sent this way is delivered nowhere. Re-send it as an ordinary message: drop \`kind\` entirely and post the same text. Everything substantive you send, your FINAL ANSWER included, is a plain message. To mark that a step LANDED, that is dopl_channel(op="milestone", thread="<id>", body="<one line>") — a marker, not a delivery.`,
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
   * Absent = `request`: `to` addresses, and `to` is the ONLY thing that does.
   * ⚠ A DIRECT channel's auto-address is retired (2026-08-18), so `chat` no
   * longer has an addressing fallback to skip; what it still does is STATE that
   * the post is not work for anybody, which the receiving side reads.
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
  /**
   * THE STRUCTURED ESCALATION PAYLOAD, set only by `op="escalate"`.
   *
   * ⚠ IT RIDES THIS OP RATHER THAN GROWING A SECOND DELIVERY PATH — `milestone`'s
   * precedent exactly. What `escalate` adds over `post` is a validated payload
   * and its own result guidance; the message, the addressing, the 4xx mapping
   * and every result line below are the same ones.
   *
   * ⚠ NOT `metadata`. The server strips `metadata.escalation` from caller input
   * unconditionally and re-stamps it only from this validated field, because the
   * card it renders carries buttons that write back and wake an agent.
   */
  escalation?: ChannelMessageInput["escalation"];
  /**
   * The VERB the terse result opens with. Defaults to `posted`.
   *
   * ⚠ THE OPS THAT RIDE THIS ONE NEED THEIR OWN WORD. `milestone` and
   * `escalate` both delegate here rather than growing a second delivery path,
   * and a result that opened `posted` for all three would report the wrong act
   * — the one kind of wrong nothing downstream can detect.
   */
  resultHead?: string;
  /**
   * Facts only the CALLING op knows, appended after the shared ones. ⚠ Kept to
   * things the server observed about this write (an option count, a resolved
   * posture) — never guidance, which belongs in `channel-doctrine.ts`.
   */
  resultFacts?: Record<string, FactValue>;
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
      // ⚠ Omitted on every ordinary post, so no existing wire shape moved.
      escalation: opts.escalation,
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

  // ── THE RESULT: ONE LINE OF FACTS (T10/T12, 2026-09-02) ──────────────────
  //
  // ⚠ WHAT THIS REPLACED, AND THE RULE THAT DECIDED IT. A successful post used
  // to return ~2.5–3.5k characters: the addressing paragraph, the thread-linkage
  // paragraph, the per-mention breakdown, the five causes a tag resolves to
  // nobody, the main-room sparseness bar, the await lecture and its stop rule.
  // Every one of those was true BEFORE this call and is true AFTER it — standing
  // doctrine, re-transmitted on every write, ~25 times in one measured
  // orchestration run. It is stated once now, in `channel-doctrine.ts`.
  //
  // ⚠ EVERY FIELD BELOW IS SOMETHING ONLY THIS CALL KNOWS, and each replaces a
  // paragraph rather than deleting one:
  //   seq/msg   — the cursor and the id a follow-up call needs.
  //   thread    — read off the STORED message, so `landed=dropped` still catches
  //               the silent tag-drop the long note existed for.
  //   addressed — T12: the whole of the "NOT ADDRESSED" paragraph. `no` means no
  //               agent was put in front of this post; the doctrine says why.
  //   intent    — `chat` addresses nobody ON PURPOSE, so it must be
  //               distinguishable from a forgotten `to`.
  //   tags      — the server's own mention resolution. THE ONE THING IN THE
  //               PRODUCT THAT CATCHES A MISSPELLED HANDLE (INVARIANTS §10):
  //               `0/1` is the verdict, and it may never be dropped for brevity.
  //   wake      — the `@agent-…` handles the body named. NOT counted in `tags`:
  //               they resolve on the operator's machine, never on the server.
  //   await     — the one runtime-derived branch: arm from this seq, or skip.
  const landing = threadFacts(
    message,
    // ⚠ The caller named a thread if EITHER argument carried one. `metadata` is
    // a caller-settable passthrough whose schema description tells agents to
    // put `taskId` in it, and it is forwarded untouched when `thread` is
    // absent — reading `opts.thread` alone makes such a post look unthreaded
    // and produces a false `landed=dropped`.
    opts.thread ??
      (typeof opts.metadata?.taskId === "string" && opts.metadata.taskId.trim()
        ? opts.metadata.taskId
        : undefined),
  );
  const mentions = postMentionFacts(body, message);
  return ok(
    factsLine(opts.resultHead ?? "posted", {
      seq: message.seq,
      msg: message.id,
      thread: landing.thread,
      landed: landing.landed,
      // ⚠ Read off `toUserId`, which is what the server was given — never off
      // `toLabel`, which is only ever the render of it.
      addressed: !!toUserId,
      intent: opts.intent ?? "request",
      tags: mentions.tags,
      wake: mentions.wake,
      await: awaitFact(opts.runtime ?? null, message.seq),
      ...(opts.resultFacts ?? {}),
    }),
  );
}

