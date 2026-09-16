import "server-only";
import type { ChannelDelivery, ChannelWakeVerdict } from "../types";
import type { ChannelMessageCreateInput } from "../schema";
import type { ChannelRow } from "./dto";
// ⚠ THE AGENT-HANDLE DOOR IS `service-wake-verdict-handles.ts` (§1 split,
// 2026-09-04) — one place decides which agent a handle names and whose sessions
// it may look through. This file decides PRECEDENCE and nothing else about it.
import {
  ownLiveAgentIds,
  resolveAgentRecipients,
  selfAgentIdOf,
} from "./service-wake-verdict-handles";
import type { ResponderReason } from "../lib/agent-mentions";
import {
  defaultResponder,
  liveChannelSessions,
  reciprocalParty,
  recentRoomAgents,
  threadOtherParty,
  // 2026-09-06 (items 10/11): the AUTHOR's own per-member setting, replacing the channel's
  // room-wide pin. Lives beside the other resilience reads because it is one of them.
  unaddressedResponderFor,
} from "./service-wake-verdict-resilience";
import type { ChannelContext } from "./service-shared";

export { ownLiveAgentIds } from "./service-wake-verdict-handles";

/**
 * **WHO A MESSAGE IS FOR, AND WHETHER IT WOKE ANYBODY — DECIDED ON THE SERVER,
 * ONCE, AT WRITE TIME** (2026-09-02, A9; guardrails G11, G12, G15).
 *
 * ⚠ **IT DECIDES; IT DOES NOT DELIVER.** No server can reach a desktop's session
 * registry. What this produces is a STORED ANSWER the machine executes, and the
 * machine's own report comes back on the ack lane
 * (`service-writes-delivery.ts`) — a prediction and a receipt, two columns.
 *
 * ⚠ **AND IT DOES NOT NARROW THE FAN-OUT.** Whether a thread message still feeds
 * every live agent on it is Samuel's ruling 4 of 2026-08-21, and reversing it is
 * spec ruling B1 — his call, not this file's.
 *
 * ⚠ **THE PARSER IS `lib/mentions.ts` + `lib/agent-mentions.ts`, IMPORTED, NEVER
 * RESTATED** — a third spelling of "what counts as an @-tag" is F-266, already
 * paid for once. The two namespaces stay separate: that module answers *which
 * MEMBER*, `service-wake-verdict-handles.ts` answers *which AGENT*.
 * (History: ENGINEERING.md, the A9 stratum.)
 */
export interface WakeVerdictResult {
  verdict: ChannelWakeVerdict;
  /** ⚠ `null` = NOT RESOLVED HERE, and the desktop then falls back to its own
   *  body parse. `[]` = resolved to nobody. Never collapse the two. */
  recipientUserIds: string[] | null;
  recipientAgentIds: string[] | null;
  /** The server's write-time answer to "what happened". A prediction until the
   *  machine acks. */
  delivery: ChannelDelivery;
  /**
   * **WHY THIS AGENT AND NOT ANOTHER**, when the server CHOSE one the author did
   * not name — RR3's arm, as a word (2026-09-04).
   *
   * ⚠ `null` FOR EVERY ADDRESS THE AUTHOR WROTE: a reason beside a handle
   * somebody typed would invite a reader to think the server had picked. Stamped
   * into `metadata.wake_reason` on the write path and rendered by the read.
   */
  reason: ResponderReason | null;
}

/**
 * The stored `delivery` a verdict predicts, before any machine has spoken.
 *
 * ⚠ **THE THREE RESILIENCE ARMS PREDICT THE SAME OUTCOME AS THE ADDRESS THEY
 * REPAIRED, NOT A WEAKER ONE.** RR1 and RR2 resolve a MEMBER, so `delivered`;
 * RR3 resolves an AGENT, so `woken`. Predicting `idle` for them would understate
 * a wake that is about to happen, and `delivery=` is the one ack an orchestrator
 * acts on.
 */
const DELIVERY_FOR: Record<ChannelWakeVerdict, ChannelDelivery> = {
  none: "none",
  member: "delivered",
  agent: "woken",
  thread: "idle",
  thread_peer: "delivered",
  reciprocal: "delivered",
  responder: "woken",
};


/** What the write path knows that the metadata fold does not. */
export interface WakeVerdictContext {
  /** `user` or `agent`, already derived from the CREDENTIAL in
   *  `service-writes.ts` — never from the body. RR2 and RR3 are the same
   *  situation split by this one fact. */
  authorKind: string;
  /** The agent `to=` resolved to, when the caller addressed one
   *  (`service-writes-metadata-recipient.ts`). `null` for every other post. */
  toAgentId: string | null;
  /** A legacy thread tag the poster was not entitled to was dropped
   *  (`service-writes-metadata.ts › PostMetadataResult.threadTagStripped`). */
  threadTagStripped?: boolean;
  /**
   * **THE MEMBER HANDLES THIS ROOM ALREADY OCCUPIES**, so the agent namespace mints around them
   * (2026-09-07 — members outrank agents, Samuel's suffix ruling).
   *
   * ⚠ **IT IS THE METADATA FOLD'S LEFTOVER RATHER THAN A READ OF ITS OWN** —
   * `resolveBodyMentions` already derived these from a roster read this request has paid for
   * (`PostMetadataResult.memberHandles`), so the server's precedence matches the client's at
   * zero extra cost. Asking for it here would be two reads on the hot write path.
   *
   * ⚠ **ABSENT IS TODAY'S BEHAVIOUR, NOT A FAILURE** — see `resolveAgentRecipients`.
   */
  reservedHandles?: readonly string[];
}

/**
 * **THE VERDICT.** Runs on the write path, after `resolvePostMetadata` has
 * decided what `metadata` holds, so it reads the SERVER'S OWN stamps
 * (`to_user_id`, `taskId`, `taskCreatedBy`, `taskTarget`) and never the caller's
 * claim.
 *
 * PRECEDENCE — strongest reach first, because the verdict answers *what this
 * message DID*, and waking an agent is the loudest thing it can do:
 *   1. `agent`   `to=` named an agent, or the body named a live agent of the
 *                author's own.
 *   2. `member`  `to=` named a member; their side decides what runs.
 *   3. **the three RESILIENCE arms** (B1) — see below.
 *   4. `thread`  no recipient, but a thread tag — it reaches sessions already
 *                working that thread and wakes nothing.
 *   5. `none`    nothing.
 *
 * ⚠ **THE RESILIENCE ARMS RUN ONLY WHEN NOTHING WAS ADDRESSED, AND THEY ARE
 * DISJOINT BY (in a thread?) × (author kind), SO EXACTLY ONE FIRES.** RR1 is the
 * threaded case; RR2 and RR3 are the main room, split by whether an agent or a
 * person wrote it. They exist because the fan-out narrows (`b-fanout-narrow`)
 * and Samuel's ruling in the same breath is that a forgotten `@` must never
 * stall a conversation (INVARIANTS §5 › THE RESILIENCE ARMS).
 *
 * ⚠ **A STRIPPED THREAD TAG SHORT-CIRCUITS EVERY ARM.** A post whose legacy tag
 * was dropped LOOKS like a main-room post and is not one: the author was talking
 * to a thread, and repairing its address would put those words in front of
 * whoever happens to be in the room. `delivery=none`, and the strip is the reason.
 *
 * ⚠ **ONLY `kind: 'message'` CAN REACH A SESSION** (`main/session-dispatch.js ›
 * feedLiveSession`), so a lifecycle marker or a milestone resolves the MEMBER
 * half and stops. ⚠ **THE RESILIENCE ARMS ARE UNDER THE SAME GATE**: repairing
 * the address of a `task_progress` would aim a wake at a note about a run.
 *
 * ⚠ **THE LOOP FENCE IS STRUCTURAL, NOT A BRANCH.** An agent-authored message
 * cannot reach an agent that is not its own operator's, because both agent doors
 * are own-scoped when the credential is an agent's ({@link resolveAgentRecipients}
 * here, `liveAgentHandles` in the `to=` resolver) and RR2 resolves a MEMBER by
 * construction. `authorKind` appears TWICE and only twice — to SPLIT RR2 from
 * RR3, and to choose the body parse's candidate set (2026-09-04); the second use
 * is the fence expressed as a scope rather than as a guard a reader can forget.
 *
 * ⚠ **THE ESCALATION-ANSWER DOOR IS NOT RESOLVED HERE, DELIBERATELY.**
 * `metadata.escalationAnswer.agentId` names the agent that ASKED, which belongs
 * to whoever posted the escalation — usually not the author. The machine unions
 * it in (`main/session-dispatch.js › escalationAnswerAgentIds`) against the ids
 * live on the thread, the only place that fact is knowable; resolving it here
 * would mean answering `[]` for it, and `[]` is authoritative.
 */
export async function resolveWakeVerdict(
  ctx: ChannelContext,
  channel: ChannelRow,
  input: ChannelMessageCreateInput,
  metadata: Record<string, unknown>,
  wakeCtx: WakeVerdictContext,
  now = Date.now()
): Promise<WakeVerdictResult> {
  const channelId = channel.id;
  const toUserId =
    typeof metadata.to_user_id === "string" ? metadata.to_user_id : null;
  const threaded = typeof metadata.taskId === "string";

  // ⚠ **THE KIND GATE IS HELD IN A NAMED FLAG BECAUSE THE `delivery` ARM BELOW
  // NEEDS IT TOO.** `recipientAgentIds` is `null` for TWO different reasons —
  // "handles were named and none resolved" and "the agent half was never asked,
  // because only `kind: 'message'` can reach a session" — and the column cannot
  // tell them apart.
  const isMessage = (input.kind ?? "message") === "message";

  // ⚠ **`to=@agent` IS RESOLVED BEFORE THE BODY PARSE AND OVERRIDES IT.** The
  // parameter is what the caller MEANT; a handle in prose is what they wrote.
  // With one recipient per send (`assertOneRecipientField`), a body handle
  // beside an explicit `to` cannot be a second addressee and must not become one.
  // ⚠ **AN AGENT IS NEVER A RECIPIENT OF ITS OWN POST** (2026-09-04, Samuel's
  // report). Both agent doors resolve against the AUTHOR'S OWN fresh sessions,
  // which includes the author's own, so a session that wrote its own handle in
  // prose resolved to ITSELF and the desktop woke it on its own words — an
  // unbounded loop, since the reply it wakes for can name the handle again.
  // ⚠ IT IS A DROP AT THE DOOR, NOT AN `authorKind` BRANCH AROUND THE WAKE: the
  // rule is about ONE identity, and two of an operator's agents may still wake
  // each other, which is what makes `launch_agent` a capability.
  const selfAgentId = selfAgentIdOf(metadata, wakeCtx.authorKind);
  // ⚠ THE `to=` DOOR TAKES THE SAME DROP, AND IT IS TAKEN FIRST. Its resolver is
  // own-scoped too (`service-writes-metadata-recipient.ts › liveAgentHandles`),
  // so dropping it BEFORE the body gate makes the post behave like the
  // unaddressed post it actually is: the prose is read, and the arms get a turn.
  const toAgentId =
    wakeCtx.toAgentId !== null && wakeCtx.toAgentId === selfAgentId
      ? null
      : wakeCtx.toAgentId;
  const bodyAgentIds =
    toAgentId === null && isMessage
      ? await resolveAgentRecipients(
          ctx,
          channelId,
          input.body,
          selfAgentId,
          wakeCtx.authorKind,
          // ⚠ MEMBERS OUTRANK AGENTS ON THIS DOOR TOO SINCE 2026-09-07 — see the field's note
          // on {@link WakeVerdictContext}.
          wakeCtx.reservedHandles ?? []
        )
      : null;
  const namedAgentIds = toAgentId !== null ? [toAgentId] : bodyAgentIds;

  const addressed =
    (namedAgentIds !== null && namedAgentIds.length > 0) || toUserId !== null;

  /**
   * **THE AUTHOR TYPED A HANDLE AND THIS SERVER COULD NOT SAY WHOSE IT IS** —
   * `resolveAgentRecipients`' third outcome, which is `null` and means "you
   * decide", NOT "nobody" (2026-09-14, Samuel's `@prime` report).
   *
   * ⚠ **IT IS NOT "ADDRESSED NOBODY", AND CONFLATING THE TWO RE-AIMS A POST AT A
   * DIFFERENT AGENT THAN THE ONE ITS AUTHOR NAMED.** `addressed` above reads
   * `namedAgentIds.length > 0`, so a body whose only handle failed to resolve
   * fell through it exactly like a body with no handle at all, and the arms then
   * REPAIRED an address that was never missing. A typed handle is the opposite of
   * a forgotten one, which is the arms' own charter (INVARIANTS §5).
   *
   * ⚠ **THE HONEST ANSWER IS `delivery: "unreachable"` AND `recipientAgentIds:
   * null`** — `null` sends the machine back to its own parse (the ONE place a
   * not-yet-pushed session row is knowable) and `unreachable` is G15's
   * anti-silent-miss.
   *
   * ⚠ **IT GATES RR3 AND NOTHING ELSE — see the note at that branch.** Read as a
   * general "the author addressed somebody" it is WRONG for an AGENT author,
   * whose own-scoped door answers `null` for a peer's agent it is merely not
   * permitted to name.
   *
   * ⚠ **IT IS NOT SPELLED `bodyAgentIds === null` ALONE, THOUGH THAT IS
   * EQUIVALENT TODAY.** `bodyAgentIds` is also `null` when the parse never RAN
   * (`to=` won, or a non-`message` kind) — the same two nulls `recipientAgentIds`
   * is documented not to collapse.
   */
  const namedButUnresolved =
    isMessage && toAgentId === null && bodyAgentIds === null;

  // ── THE THREE RESILIENCE ARMS (B1) ──────────────────────────────────────
  // Reached only when the author addressed NOBODY. Each answers a member id, an
  // agent id, or nothing; `resilience` stays null when no arm applies.
  let resilience:
    | {
        verdict: ChannelWakeVerdict;
        userIds: string[];
        agentIds: string[];
        reason?: ResponderReason;
      }
    | null = null;
  const repairable =
    !addressed && isMessage && wakeCtx.threadTagStripped !== true;
  if (repairable && threaded) {
    // RR1 — the thread's other party.
    const other = threadOtherParty(ctx, metadata);
    if (other !== null) {
      resilience = { verdict: "thread_peer", userIds: [other], agentIds: [] };
    }
  } else if (repairable && wakeCtx.authorKind === "agent") {
    // RR2 — whoever last addressed this agent in this room, inside the window.
    // ⚠ THE AUTHOR'S OWN LIVE AGENT IDS GO WITH IT (F-589): one half of the arm's
    // key is the `client_msg_id` stamp, which is CALLER-SUPPLIED, so the claim
    // "I am agent X" is checked against the projection before it may select a
    // recipient. ⚠ THE METADATA GOES WITH IT TOO (2026-09-04): the arm's OTHER
    // key is `metadata.session_id`, the server's own stamp, which is what makes
    // it fire for a post that supplied its own idempotency key.
    const { ids } = await ownLiveAgentIds(ctx, channelId, now);
    const party = await reciprocalParty(channelId, input, metadata, now, ids);
    if (party !== null) {
      resilience = { verdict: "reciprocal", userIds: [party], agentIds: [] };
    }
  } else if (repairable && !namedButUnresolved) {
    // ⚠ **`!namedButUnresolved` IS ON RR3 ALONE, AND THE ASYMMETRY IS THE WHOLE
    // POINT** (2026-09-14). RR1 and RR2 answer with a **MEMBER**; RR3 is the only
    // arm that answers with an **AGENT**, so it is the only one that can replace
    // *the agent you named* with *a different agent* — the reported harm. A member
    // repair takes nothing from a handle in the prose: that member's side still
    // decides what runs.
    // ⚠ **AND GATING RR2 ON IT WOULD RE-OPEN #963 / #965 / #969 / #973.** An AGENT
    // author's door is own-scoped, so a body naming a PEER's agent answers `null`
    // meaning *"I may not resolve that"*, not *"nobody answers to that"*.
    // `service-wake-verdict-resilience.test.ts › never reports unreachable for a
    // delivery that happened` holds that line.

    // RR3 — who answers an untagged message, **the AUTHOR'S OWN setting** since
    // 2026-09-06 (Samuel's ruling on items 10 and 11; it was the channel's pin).
    //
    // ⚠ **THE READ IS FIRST, AND THAT ORDER IS THE POINT.** `unaddressedResponderFor` is one
    // keyed lookup on `(channel_id, user_id)`; doing it BEFORE `liveChannelSessions` means a
    // member who chose "No one" costs ZERO extra reads rather than one.
    // ⚠ **IT IS A NEW READ ON THE POST PATH — SAID PLAINLY.** It sits inside the `repairable`
    // branch only, so it is not a new class of cost, but it is one more round trip on messages
    // that reach RR3. The author's membership is not in scope here (this takes `ctx` and the
    // channel ROW), so the options were this read or threading a membership through four call
    // sites for one field.
    // ⚠ COERCED AT THE BOUNDARY, so an unreadable row lands on the DEFAULT and never on
    // `"none"`: a database hiccup must not silently stop answering somebody who never chose
    // that (`normalizeUnaddressedResponder`).
    const setting = await unaddressedResponderFor(channelId, ctx.userId);
    const responder = await defaultResponder(
      setting,
      // ⚠ PRESENCE-KEYED SINCE 2026-09-05, not freshness-keyed: an idle agent is
      // still a live addressee. See `liveChannelSessions`' own note.
      setting === "none" ? [] : await liveChannelSessions(ctx, channelId),
      // ⚠ THE AUTHOR'S OWN HABIT, WHICH IS WHY `ctx.userId` IS THE KEY (Samuel, 2026-09-04).
      // RR3's gate is that a PERSON wrote this message, so the author IS the person whose last
      // tag we are reading — and two people in one room each keep their own default.
      () => recentRoomAgents(channelId, ctx.userId, now)
    );
    // ⚠ AND THE DEFAULT RESPONDER IS NEVER THE AUTHOR EITHER — belt over the door
    // above. `selfAgentId` is null here today; stating it keeps the one-live-agent
    // room correct if the arm's gate ever widens.
    if (responder !== null && responder.agentId !== selfAgentId) {
      resilience = {
        verdict: "responder",
        userIds: [],
        agentIds: [responder.agentId],
        reason: responder.reason,
      };
    }
  }

  const verdict: ChannelWakeVerdict =
    namedAgentIds !== null && namedAgentIds.length > 0
      ? "agent"
      : toUserId
        ? "member"
        : (resilience?.verdict ??
          (threaded && wakeCtx.threadTagStripped !== true ? "thread" : "none"));

  // ⚠ **A REPAIRED RECIPIENT IS STORED IN THE SAME TWO COLUMNS AS A WRITTEN
  // ONE.** The desktop executes `recipient_*` and reads `wake_verdict` to
  // EXPLAIN what it did; splitting repaired recipients into columns of their own
  // would mean two delivery paths, which `b-fanout-narrow` exists to collapse.
  const recipientUserIds = toUserId
    ? [toUserId]
    : (resilience?.userIds ?? []);
  const recipientAgentIds =
    namedAgentIds !== null && namedAgentIds.length > 0
      ? namedAgentIds
      : resilience !== null
        ? resilience.agentIds
        : bodyAgentIds;

  return {
    verdict,
    recipientUserIds,
    recipientAgentIds,
    reason: resilience?.reason ?? null,
    // ⚠ **`unreachable` IS AN OUTCOME THE VERDICT ENUM CANNOT EXPRESS, WHICH IS
    // WHY THE TWO ARE SEPARATE FIELDS.** The BODY named an agent and nothing this
    // server can see answers to it; reporting the verdict's own outcome would say
    // "you addressed nobody" about a post whose whole point was a name — the
    // silent miss G15 describes. Four terms narrow it:
    //   · `isMessage` — a lifecycle marker never asked the agent half, so its
    //     `null` says nothing about reach (2026-09-02).
    //   · `toAgentId === null` — an UNRESOLVED `to=` never reaches here at all
    //     (2026-09-02, B4: a 400 `CHANNEL_RECIPIENT_UNRESOLVED` listing the live
    //     handles), and a resolvable one is a stronger reach that wins.
    //   · `verdict !== "member"` — same: it reached somebody.
    //   · `resilience === null` — a repaired address means this message reached a
    //     real recipient, so `unreachable` would describe the one thing that did
    //     NOT happen.
    delivery:
      isMessage &&
      bodyAgentIds === null &&
      toAgentId === null &&
      verdict !== "member" &&
      resilience === null
        ? "unreachable"
        : DELIVERY_FOR[verdict],
  };
}
