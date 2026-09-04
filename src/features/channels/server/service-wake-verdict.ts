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
import {
  defaultResponder,
  freshChannelSessions,
  reciprocalParty,
  threadOtherParty,
} from "./service-wake-verdict-resilience";
import type { ChannelContext } from "./service-shared";

export { ownLiveAgentIds } from "./service-wake-verdict-handles";

/**
 * **WHO A MESSAGE IS FOR, AND WHETHER IT WOKE ANYBODY — DECIDED ON THE SERVER,
 * ONCE, AT WRITE TIME** (2026-09-02, A9; guardrails G11, G12, G15).
 *
 * ⚠ **THIS FILE EXISTS BECAUSE THE RULE USED TO LIVE ON EVERY DESKTOP AND
 * NOWHERE ELSE.** `main/session-dispatch.js › mentionedAgentIds` parsed the
 * BODY, `main/session-wake-tiers.js` decided the wake and `main/targeting.js`
 * classified in parallel — three modules, each stating that it must not read the
 * others — while the server stored the row with no delivery semantics at all.
 * The consequences were not stylistic: the addressing doctrine had to be written
 * against the WEAKEST build in the field (`packages/mcp-server/src/tools/
 * channel-addressing.ts` says so in as many words), and "a message @-mentioning
 * another agent is not addressed to you" was a request, because every live
 * session on the thread was handed the same `addressing` array.
 *
 * ⚠ **IT DECIDES; IT DOES NOT DELIVER.** No server can reach a desktop's session
 * registry. What this produces is a STORED ANSWER the machine executes, and the
 * machine's own report comes back on the ack lane
 * (`service-writes-delivery.ts`). The two are different columns because they are
 * different claims — a prediction and a receipt.
 *
 * ⚠ **AND IT DOES NOT NARROW THE FAN-OUT.** Whether a thread message still feeds
 * every live agent on it is Samuel's ruling 4 of 2026-08-21, and reversing it is
 * spec ruling B1 — his call, not this slice's. Everything here is additive: the
 * desktop gains an answer it did not have and loses no reach.
 */

/**
 * ⚠ **THE PARSER IS `lib/mentions.ts` + `lib/agent-mentions.ts`, IMPORTED, NEVER
 * RESTATED.** Those two already own the handle grammar for the web transcript's
 * tint, and `service-writes-metadata-mentions.ts` already resolves the MEMBER
 * namespace through them on this exact write path. A third spelling of "what
 * counts as an @-tag" is how the tint, the stamp and the wake come to disagree —
 * which is F-266, already paid for once.
 *
 * ⚠ The two namespaces stay separate: `lib/mentions.ts` answers *which MEMBER*,
 * this answers *which AGENT*, and an agent is not a member.
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
}

/**
 * The stored `delivery` a verdict predicts, before any machine has spoken.
 *
 * ⚠ **THE THREE RESILIENCE ARMS PREDICT THE SAME OUTCOME AS THE ADDRESS THEY
 * REPAIRED, NOT A WEAKER ONE.** A repaired address is a real address: RR1 and
 * RR2 resolve a MEMBER, so `delivered` — their side decides what runs — and RR3
 * resolves an AGENT, so `woken`. Predicting `idle` for them because the author
 * did not type the name would understate a wake that is about to happen, and
 * `delivery=` is the one ack an orchestrator acts on.
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
 * person wrote it. There is no precedence question BETWEEN them — the ordering
 * above is about explicit addressing versus repair, not about the three.
 *
 * ⚠ **THEY EXIST BECAUSE THE FAN-OUT NARROWS** (`b-fanout-narrow`). Narrowing
 * delivery to the addressed recipient, on its own, means a message that named
 * nobody reaches nobody — and Samuel's ruling in the same breath is that a
 * forgotten `@` must never stall a conversation. The repair is the server's, so
 * every desktop gets it at once and the weakest build in the field does not set
 * the rule.
 *
 * ⚠ **A STRIPPED THREAD TAG SHORT-CIRCUITS EVERY ARM.** A post whose legacy tag
 * was dropped (the poster is not in that exchange) LOOKS like a main-room post
 * and is not one: the author was talking to a thread. Repairing its address
 * would put words the author aimed elsewhere in front of whoever happens to be
 * in the room. `delivery=none`, and the strip is the reason.
 *
 * ⚠ **ONLY `kind: 'message'` CAN REACH A SESSION** (`main/session-dispatch.js ›
 * feedLiveSession`, the kind filter it calls "the last word on this machine"), so
 * a lifecycle marker or a milestone resolves the MEMBER half and stops. Stating
 * it here rather than letting the agent half quietly resolve to nothing keeps the
 * two facts separable when the kind set moves — which `scripts/
 * check-message-kind-drift.ts` now guards. ⚠ **THE RESILIENCE ARMS ARE UNDER THE
 * SAME GATE**, and for a sharper reason: repairing the address of a
 * `task_progress` would aim a wake at a note about a run, which is the row shape
 * that stamped `unreachable` across every thread's own progress notes the first
 * time this gate was missing.
 *
 * ⚠ **THE LOOP FENCE IS STRUCTURAL, NOT A BRANCH.** An agent-authored message
 * cannot reach an agent that is not its own operator's: both agent doors are
 * own-scoped when the credential is an agent's ({@link resolveAgentRecipients}
 * here, `liveAgentHandles` in the `to=` resolver), and RR2 resolves a MEMBER by
 * construction. There is deliberately no `authorKind === "agent"` test guarding
 * a wake: a second spelling of the loop fence is exactly what the desktop's
 * three-module version cost.
 * ⚠ `authorKind` appears TWICE and only twice — to SPLIT RR2 from RR3, and to
 * choose the body parse's candidate set (2026-09-04). The second use is the
 * fence itself expressed as a scope rather than as a guard: an agent author
 * reads its OWN fresh sessions, a person reads the ROOM's. Both remain single
 * statements of the carve, in the two places that resolve an agent id.
 *
 * ⚠ **THE ESCALATION-ANSWER DOOR IS NOT RESOLVED HERE, DELIBERATELY.**
 * `metadata.escalationAnswer.agentId` names the agent that ASKED, which belongs
 * to whoever posted the escalation — usually not the author. The machine unions
 * it in (`main/session-dispatch.js › escalationAnswerAgentIds`) against the ids
 * live on the thread, which is the only place that fact is knowable. Resolving it
 * here would mean answering `[]` for it, and `[]` is authoritative.
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
  // tell them apart. Reading the null alone is what stamped `unreachable` on
  // every `task_progress` and `task_finished` row ever written.
  const isMessage = (input.kind ?? "message") === "message";

  // ⚠ **`to=@agent` IS RESOLVED BEFORE THE BODY PARSE AND OVERRIDES IT.** The
  // parameter is what the caller MEANT; a handle in prose is what they wrote.
  // With one recipient per send (`assertOneRecipientField`), a body handle
  // beside an explicit `to` cannot be a second addressee and must not become
  // one.
  // ⚠ **AN AGENT IS NEVER A RECIPIENT OF ITS OWN POST** (2026-09-04, Samuel's
  // report). Both agent doors resolve against the AUTHOR'S OWN fresh sessions —
  // which is the same-account carve working — and the author's own session is in
  // that set, so a session that wrote its own handle (or its own rename) in prose
  // resolved to ITSELF, was stored as `recipient_agent_ids`, and the desktop
  // executed the stored answer and woke it on its own words. It cost three turns
  // of a 1M-context session in one four-minute stretch, and the loop is
  // unbounded: the reply it wakes for can name the same handle again.
  // ⚠ IT IS A DROP AT THE DOOR, NOT AN `authorKind` BRANCH AROUND THE WAKE. The
  // rule is about ONE identity, not about agent-authored posts in general: two of
  // an operator's agents may still wake each other, which is what makes
  // `launch_agent` a capability.
  const selfAgentId = selfAgentIdOf(metadata, wakeCtx.authorKind);
  // ⚠ THE `to=` DOOR TAKES THE SAME DROP, AND IT IS TAKEN FIRST. Its resolver is
  // own-scoped too (`service-writes-metadata-recipient.ts › liveAgentHandles`),
  // so an agent can name itself there as readily as in prose. Dropping it BEFORE
  // the body gate is what makes the post behave like the unaddressed post it
  // actually is: the prose is read, and the resilience arms get their turn.
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
          now,
          selfAgentId,
          wakeCtx.authorKind
        )
      : null;
  const namedAgentIds = toAgentId !== null ? [toAgentId] : bodyAgentIds;

  const addressed =
    (namedAgentIds !== null && namedAgentIds.length > 0) || toUserId !== null;

  // ── THE THREE RESILIENCE ARMS (B1) ──────────────────────────────────────
  // Reached only when the author addressed NOBODY. Each answers a member id, an
  // agent id, or nothing; `resilience` stays null when no arm applies.
  let resilience:
    | { verdict: ChannelWakeVerdict; userIds: string[]; agentIds: string[] }
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
    // ⚠ THE AUTHOR'S OWN LIVE AGENT IDS GO WITH IT (F-589): the arm keys on a
    // `client_msg_id` stamp, which is CALLER-SUPPLIED and names a public id, so
    // the claim "I am agent X" is checked against the projection before it is
    // allowed to select a recipient. Resolved HERE because {@link
    // ownLiveAgentIds} is this file's, and `service-wake-verdict-resilience.ts`
    // cannot import it without a cycle — one definition of "a live agent of
    // mine", handed over rather than restated.
    const { ids } = await ownLiveAgentIds(ctx, channelId, now);
    const party = await reciprocalParty(channelId, input, now, ids);
    if (party !== null) {
      resilience = { verdict: "reciprocal", userIds: [party], agentIds: [] };
    }
  } else if (repairable) {
    // RR3 — the channel's default responder, or its one live agent.
    const responder = defaultResponder(
      channel,
      await freshChannelSessions(ctx, channelId, now)
    );
    // ⚠ AND THE DEFAULT RESPONDER IS NEVER THE AUTHOR EITHER — belt over the
    // door above. RR3's gate is that a PERSON wrote the message, so `selfAgentId`
    // is null here today; stating it keeps the one-live-agent room correct if the
    // arm's gate ever widens, which is the room this incident happened in.
    if (responder !== null && responder !== selfAgentId) {
      resilience = { verdict: "responder", userIds: [], agentIds: [responder] };
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
  // would mean two delivery paths, which is the arrangement `b-fanout-narrow`
  // exists to collapse.
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
    // ⚠ **`unreachable` IS AN OUTCOME THE VERDICT ENUM CANNOT EXPRESS, WHICH IS
    // WHY THE TWO ARE SEPARATE FIELDS.** The BODY named an agent and nothing this
    // server can see answers to it. Reporting the verdict's own outcome instead
    // would say "you addressed nobody" (`none`) or "it went to the thread"
    // (`idle`) about a post whose whole point was a name — precisely the
    // silent-miss G15 describes.
    // ⚠ **AN UNRESOLVED `to=` NEVER REACHES HERE (2026-09-02, B4).** That door
    // is a 400 `CHANNEL_RECIPIENT_UNRESOLVED` listing the live handles, raised
    // before the write. `unreachable` is now exactly one situation: a handle in
    // PROSE that resolves to nothing — which is not a refusal, because prose is
    // not an address and a message may legitimately mention an agent that is
    // not here.
    // ⚠ **A STRONGER REACH WINS.** An unresolvable handle beside a real `to=` is
    // not the story of that message: it reached somebody, and the machine
    // settles the rest.
    // ⚠ **AND A REPAIRED ADDRESS OUTRANKS IT TOO.** A resilience arm that fired
    // means this message reached a real recipient, so reporting `unreachable`
    // about a name in its prose would describe the one thing that did NOT
    // happen.
    // ⚠ **AND IT IS GATED ON THE KIND** (2026-09-02). A lifecycle marker or a
    // milestone never asked the agent half, so its `null` says nothing about
    // reach; without this term every non-message row was stamped `unreachable`,
    // and an orchestrator reading a thread's own progress notes saw a room full
    // of failed deliveries that never happened.
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
