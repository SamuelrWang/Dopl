/**
 * `dopl_channel` op="send" — send a message or a structured activity event.
 * Resolve the addressing, make the call, map the 4xx, hand the outcome to the
 * modules that narrate it.
 *
 * ⚠ BOUNDARY: wire/storage name `task` == domain name `thread`. The `thread` op
 * param folds into `metadata.taskId` and `task_*` kinds keep their stored
 * names; only the agent-facing surface says `thread`.
 *
 * ⚠ PEER-CONTROLLED TEXT. Every string below is server NARRATION with no
 * untrusted framing, and one peer-authored value splices into it: `ch.name` —
 * `resolveChannelOr` lists PUBLIC channels the caller was never invited to, so
 * the name can come from someone the agent never contacted. ⚠ A SECOND ONE LEFT
 * WITH THE CLIENT-SIDE MEMBER LOOKUP (B8): the addressee's display name was
 * spliced into two refusals, and the server now owns that resolution — so the
 * name never reaches this module and `serverDetail` carries the one place it
 * still appears, neutralized there.
 *
 * ⚠ A send addresses ONE party or nobody, and `to` is the whole of it: with one
 * the message reaches that member's machine — or, for an agent handle, that
 * agent — and without one it is chat and reaches nobody. ⚠ **THE REF GOES OUT
 * AS GIVEN AND THE SERVER RESOLVES IT** (2026-09-02, B8): `to` is a union over
 * two namespaces, so resolving the member half here would mean two resolvers
 * disagreeing about one field, and a `@handle` this side cannot see would come
 * back as "not a member" instead of the 400 that lists the live handles.
 */

import type { ChannelMessageInput, DoplClient } from "@dopl/client";
import { ok, err, type ToolResponse } from "./respond";
// ⚠ THE RESULT IS ONE LINE OF FACTS (T10/T12). Each import below contributes
// FIELDS, not prose; the standing rules they used to restate live once in
// `channel-doctrine.ts`, behind `op="rooms" action="help"`.
import { deliveryFact, factsLine, type FactValue } from "./channel-facts";
// "Did it thread?" — the question a sender cannot otherwise settle.
import { threadFacts } from "./channel-post-linkage";
// "What became of the `@…` tokens?" — the server's own resolution, read back.
import { postMentionFacts } from "./channel-post-guidance";
import { inlineOr, isErr, resolveChannelOr } from "./channel-shared";
// ⚠ Whether a pending HOLD outlives the turn is a CLIENT property this
// server cannot see — one module decides what may be claimed about it.
import { holdFact } from "./channel-wake-guidance";
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
 * G14 — **A MILESTONE IS ONE LINE, AND THAT IS NOW A BOUND RATHER THAN A WORD.**
 *
 * ⚠ The op shared `post`'s 16,000-character cap while three surfaces asked, in
 * prose, for "ONE LINE naming the step that just landed" — and a rule stated
 * only in prose is the rule a model spends a paragraph on. 240 characters is
 * about two lines of terminal width; the NEWLINE check is the sharper half,
 * because a multi-line milestone is a report wearing a marker's op, and the
 * card that renders it shows one line whatever it was sent.
 *
 * ⚠ **THE REFUSAL NAMES THE OTHER LANE**, since the caller has real content in
 * hand: refusing without saying where it goes is how a deliverable ends up
 * squeezed into a marker.
 */
export const MILESTONE_MAX_CHARS = 240;

export function milestoneRefusal(body: string): ToolResponse | null {
  const over = body.length > MILESTONE_MAX_CHARS;
  const multiline = /[\r\n]/.test(body);
  if (!over && !multiline) return null;
  return err(
    `Nothing was posted: a milestone is ONE LINE marking a step that just landed, and yours ${over ? `is ${body.length} characters (the cap is ${MILESTONE_MAX_CHARS})` : "spans more than one line"}. The bound is the point of the op — a milestone carries no content, so a requester watching several agents can read a page of them at a glance. Send the substance with dopl_channel(op="send", thread="<the same id>", body=…), then mark it with one short line here.`,
  );
}

/**
 * **THE `kind="decision"` BODY CAP, AND IT IS THE ROUTE'S** (2026-09-02, B8).
 * A decision's CONTEXT is the send's `body`, which folds two params into one —
 * and the two had different bounds: a message may be 16,000 characters, an
 * escalation's context 2,000 (`src/features/channels/escalation.ts ›
 * ESCALATION_CONTEXT_MAX`). Publishing the looser cap and letting the route
 * refuse would send back an opaque VALIDATION_FAILED about a field the caller
 * never named, so the tighter bound is checked here, before the wire, and the
 * refusal says which lane the extra prose belongs in.
 */
export const DECISION_CONTEXT_MAX_CHARS = 2000;

export function decisionRefusal(body: string): ToolResponse | null {
  if (body.length <= DECISION_CONTEXT_MAX_CHARS) return null;
  return err(
    `Nothing was posted: on kind="decision" the \`body\` is the CONTEXT on the card, and a card is read at a glance — yours is ${body.length} characters against a cap of ${DECISION_CONTEXT_MAX_CHARS}. Say what a person needs to know to CHOOSE and nothing else; the options carry their own consequences. Send the working detail as an ordinary message on the same thread first, then ask.`,
  );
}

/** Options accepted by opPost — the per-post flags routed from the registrar. */
interface PostOptions {
  /**
   * ⚠ **NOT A CALLER'S ARGUMENT ANY MORE** (C12, 2026-09-02). `kind` left the
   * published shape — three of its five values were refused, one had its own op
   * and one was the default — and the only writer left is `op="send" with kind="milestone"`,
   * which fixes it to `task_progress` at the routing seam.
   */
  kind?: ChannelMessageInput["kind"];
  metadata?: Record<string, unknown>;
  clientMsgId?: string;
  /**
   * The ONE recipient, in either namespace — a member (email or user id) or an
   * agent (`@agent-<id>` / `@<handle>`). ⚠ Sent AS GIVEN; the server resolves it.
   */
  to?: string;
  /** One-line intent for the receiver's notification. */
  summary?: string;
  /** A thread id — threads this post under that thread's card (server-validated). */
  thread?: string;
  /**
   * Caller's OBSERVED runtime stamp (`CallerIdentity.runtime`). Changes nothing
   * this op does — only what the result may claim about waiting for the reply.
   */
  runtime?: string | null;
  /**
   * THE STRUCTURED ESCALATION PAYLOAD, set only by `op="send" with kind="decision"`.
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
  const ch = await resolveChannelOr(client, channelRef);
  if (isErr(ch)) return ch;
  const chName = inlineOr(ch.name, NO_NAME);

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
      // ⚠ THE UNION FIELD, NOT `toUserId`. One recipient, one resolver, one
      // refusal — see this module's header.
      to: opts.to,
      summary: opts.summary,
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
            `Couldn't address the message — that member isn't in **${chName}**. Add them with dopl_channel(op="rooms", action="invite"), or send without \`to\`.`,
          );
        // ⚠ NOTHING WAS WRITTEN, and the server's own message lists the live
        // handles and the roster — which is the whole remedy, so this arm adds
        // the one fact that message cannot carry: no row exists to retract.
        case "recipient_unresolved":
          return err(
            `Nothing was sent to **${chName}**: \`to\` named nobody this workspace can see.${serverDetail(e)} Fix the name and send again — a send is never delivered to a recipient that does not resolve.`,
          );
        case "thread_not_in_channel":
          return err(
            `That thread is not in this channel — check the thread id, or send without \`thread\`.`,
          );
        case "invalid_request":
          return err(
            `That message was rejected as INVALID before it reached **${chName}** — nothing was sent, and this is NOT a membership or thread problem, so do not invite anyone or change \`thread\` over it.${serverDetail(e)} ${FIELD_CAPS_NOTE} Shorten the field that is over and post again.`,
          );
        case "workspace":
          return err(
            `The post was rejected because the call carried no usable workspace.${serverDetail(e)} This is a connection-level problem, not a channel one — report it to your operator.`,
          );
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
      // ⚠ THE BELT FOR A BYPASSED BUILD. No caller can name a lifecycle kind
      // any more — `kind` left the published shape (C12) and only op="send" with kind="milestone"
      // sets one, to the single value the lane allows — so this is unreachable
      // through the tool. It is answered with the RULE rather than dropped into
      // a membership arm, because the one thing it must never read as is "you
      // left the channel".
      if (kind === "lifecycle_kind") {
        return err(
          'Nothing was sent: that message carried a LIFECYCLE kind ("task_started" / "task_finished" / "task_failed"), which the runtime that starts and stops a session writes and an agent credential may not. Send the same text as an ordinary message — everything substantive you send, your FINAL ANSWER included, is one — and mark a step that LANDED with kind="milestone".',
        );
      }
      if (opts.thread && kind !== "not_a_member") {
        // A thread belongs to its CREATOR and its addressee; that pair is the
        // whole write gate.
        //
        // ⚠ The thread id is NOT echoed here. It round-trips (an agent copies
        // it from a `read` legend = `metadata.taskId`, peer-set verbatim for
        // non-UUID values), and "the id you just passed" needs no escaping.
        return err(
          `You can't post into that thread — nothing was posted. A thread is between the member who OPENED it and the member it is addressed TO, and you are neither: check it with dopl_channel(op="read", channel="${ch.id}", thread=<the id you just passed>). Send into the channel instead, or ask one of those two to open a thread with you. Do NOT open your own thread for the same work; that is a duplicate room, not a way in.`,
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
  // nobody, the main-room sparseness bar, the hold lecture and its stop rule.
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
  //   ⚠ `intent` WAS A FIELD HERE and is not one now (C12): it could only
  //               ever restate `addressed`, since chat is exactly "no `to`",
  //               and two fields for one fact is what let them disagree.
  //   tags      — the server's own mention resolution. THE ONE THING IN THE
  //               PRODUCT THAT CATCHES A MISSPELLED HANDLE (INVARIANTS §10):
  //               `0/1` is the verdict, and it may never be dropped for brevity.
  //   wake      — the `@agent-…` handles the body named. NOT counted in `tags`:
  //               they resolve on the operator's machine, never on the server.
  //   hold      — the one runtime-derived branch: arm from this seq, or skip.
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
  // ⚠ **A CONVERGED RETRY OPENS WITH THE FACT THAT NOTHING WAS WRITTEN**
  // (2026-09-04). The server's idempotency short-circuit returns the STORED row
  // and writes nothing; the ack was byte-identical to a first post, which is why
  // one row (seq 963) read as two messages in an agent's own transcript. It is
  // the HEAD rather than a field because "posted" is the claim that is wrong —
  // a caller that scans the first word must not read a replay as a send.
  // ⚠ THE SEQ IS IN IT, and repeating it in `seq=` costs nothing worth saving:
  // the head is prose a reader takes at a glance and the fields are what a
  // parser reads, and neither should have to consult the other.
  const head = message.replayed
    ? `already posted as #${message.seq} (idempotent replay — not re-sent)`
    : (opts.resultHead ?? "posted");
  return ok(
    factsLine(head, {
      seq: message.seq,
      msg: message.id,
      thread: landing.thread,
      landed: landing.landed,
      // ⚠ **READ OFF THE STORED ROW, NOT OFF THE ARGUMENT** (2026-09-02, B8).
      // `to` is now resolved server-side over two namespaces, so the only honest
      // answer to "was an agent put in front of this" is the recipient set the
      // server wrote. ⚠ `null`/absent is NOT "nobody": it is a server that
      // computed no recipients, and `[]` is the resolved-to-nobody case.
      addressed:
        (message.recipientUserIds?.length ?? 0) > 0 ||
        (message.recipientAgentIds?.length ?? 0) > 0,
      tags: mentions.tags,
      wake: mentions.wake,
      // ⚠ WHAT BECAME OF IT — A9's keystone contract, rendered where the caller
      // already reads the rest of the write's outcome. `woken?` is the server's
      // write-time prediction (no `deliveryAt` yet); `woken` is the operator's
      // machine reporting what it did. Absent = this server computes no verdict,
      // which is NOT `none`. See `channel-facts.ts › deliveryFact`.
      delivery: deliveryFact(message.delivery, message.deliveryAt),
      hold: holdFact(opts.runtime ?? null, message.seq),
      ...(opts.resultFacts ?? {}),
    }),
  );
}

