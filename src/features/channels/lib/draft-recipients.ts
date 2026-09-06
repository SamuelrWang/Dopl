/**
 * **WHO AN UNSENT DRAFT WOULD REACH** — the composer's recipient line, as a pure
 * function (2026-09-02, v2 wave B slice B10, Samuel's ruling).
 *
 * ⚠ **THE PROBLEM IT EXISTS FOR IS A GUEST'S, NOT AN OPERATOR'S** (Samuel): a
 * person in a channel *"doesn't know that there's a tagging function and that the
 * tagging function is required for the agent to see the message"*. The @-picker
 * makes tagging DISCOVERABLE; this makes its consequence VISIBLE, before the
 * send rather than after it. Between them, "nothing answered me" stops being a
 * thing you find out by waiting.
 *
 * ⚠ **IT PREDICTS THE SERVER'S STORED VERDICT AND MAY NEVER INVENT ONE.** The
 * authority is `server/service-wake-verdict.ts › resolveWakeVerdict`, which
 * decides at write time and stores the answer (INVARIANTS §5, THE DELIVERY
 * KEYSTONE). Everything here is the same question asked one moment earlier, over
 * the same parsers — `lib/mentions.ts` for the MEMBER namespace,
 * `lib/agent-mentions.ts` for the AGENT one, and
 * `agent-mentions.ts › resolveDefaultResponder` for RR3, which the server's own
 * `defaultResponder` is now an adapter over. **A third spelling of "what counts
 * as an @-tag" is F-266, already paid for once.**
 *
 * ⚠ **THE ARMS MODELLED HERE ARE THE ONES THE CHANNEL COMPOSER CAN REACH: a
 * PERSON, writing `kind:'message'`, addressing nobody through `to=`** (this
 * surface has never sent that field). So: the body's own tags, else RR3. RR2 is
 * an agent author's arm and no browser holds an agent credential; RR1 is the
 * thread arm and {@link draftReach} is told about it through
 * `threadOtherParty` rather than re-deriving a thread's parties.
 *
 * ⚠ **RR3 IS ALL FOUR OF ITS ARMS SINCE 2026-09-04, INCLUDING THE TWO THAT
 * CHOOSE.** "Two live agents and no setting" used to answer `nobody` on both
 * sides; it now names the agent that spoke here last, else the one launched
 * last, and the LINE says which — `reason`. A composer that kept saying
 * `nobody` for a post the server is about to route would be worse than no line
 * at all, which is the whole standard this file is held to.
 *
 * ⚠ **WHAT IT DELIBERATELY DOES NOT MODEL: the bare `@<id>` form** the desktop
 * routes on and the web index does not claim (**F-448**, and
 * `service-wake-verdict.ts › bareId` is the server's own normalisation for it).
 * The picker never inserts that form, so predicting it here would be a rule with
 * no producer on this surface — and the honest failure is the line UNDERSTATING
 * reach, never overstating it.
 *
 * ⚠ **A MEMBER TAG IS REACH, NOT A WAKE.** `metadata.mentionedUserIds` decides
 * whose Tags inbox this lands in; it does NOT set `to_user_id` and it wakes
 * nobody's agent (INVARIANTS §5 — "unaddressed reaches nobody", and a handle in
 * prose is not an address). The line therefore names a tagged member as a
 * recipient and still lets RR3 answer when only members were tagged — the same
 * two things the server does.
 */

import { memberLabel } from "./channel-display";
import {
  agentMentionHandle,
  buildAgentMentionIndex,
  resolveAgentHandle,
  resolveDefaultResponder,
  type AgentMentionCandidate,
  type ResponderReason,
} from "./agent-mentions";
import { mentionHandleOf, mentionTokensOf, resolveMentions } from "./mentions";
import type { ChannelMember } from "../types";

/**
 * A live session as the channel's peer projection answers it
 * (`server/collab-dto.ts › mapPeerSessionStateRow`), reduced to the two fields
 * the handle rule reads.
 *
 * ⚠ **`name` IS THE AGENT ID, and that is the server's own reading of this
 * column** — `service-writes-metadata-recipient.ts › liveAgentHandles` and
 * `service-wake-verdict-resilience.ts › liveChannelSessions` both map
 * `row.name` into `agentId`. Spelling it differently here is how the picker
 * comes to offer a token the resolver does not accept.
 */
export interface LiveAgentSession {
  name: string;
  displayName?: string | null;
}

/** The peer projection -> the handle rule's candidates. ⚠ A nameless row is
 *  dropped: it claims no handle, so it can be neither offered nor addressed. */
export function liveAgentCandidates(
  sessions: readonly LiveAgentSession[]
): (AgentMentionCandidate & { displayName: string | null })[] {
  return sessions
    .filter((s) => s.name.trim().length > 0)
    .map((s) => ({ agentId: s.name, displayName: s.displayName ?? null }));
}

/**
 * One recipient the draft would reach. ⚠ The `label` is what the LINE shows and
 * the `handle` is what the DRAFT carries — different strings, and conflating
 * them is F-210 all over again.
 */
export type DraftRecipient =
  | { kind: "agent"; agentId: string; handle: string; label: string }
  | { kind: "member"; userId: string; label: string };

/**
 * HOW the recipients were arrived at, which is the one thing the line says
 * beyond the names.
 *
 *  - `tagged`    — the author wrote the address.
 *  - `responder` — nobody was addressed and RR3 answered (the channel's default
 *                  responder, or its one live agent).
 *  - `thread`    — nobody was addressed and this is a thread reply, so RR1 sends
 *                  it to the exchange's other party.
 *  - `none`      — it reaches the room and wakes nobody. **A real answer, not a
 *                  failure**: chat is a thing this product has, and "broadcast"
 *                  is not.
 */
export type DraftReachVia = "tagged" | "responder" | "thread" | "none";

export interface DraftReach {
  recipients: DraftRecipient[];
  via: DraftReachVia;
  /**
   * WHY RR3 picked this agent — `null` for every other arm, exactly as the
   * server's `WakeVerdictResult.reason` is (2026-09-04).
   *
   * ⚠ It exists because RR3 now CHOOSES between several live agents, and a
   * choice a person did not make has to be sayable. The line renders it as its
   * one-word chip.
   */
  reason: ResponderReason | null;
}

const NOBODY: DraftReach = { recipients: [], via: "none", reason: null };

/**
 * The prediction. Pure, and given everything it needs — no clock, no fetch, no
 * freshness rule of its own: the caller passes the sessions it holds to be
 * live, the same way the server's arms take theirs.
 */
export function draftReach({
  body,
  members,
  sessions,
  currentUserId,
  defaultResponderAgentName,
  recentAgentIds = [],
  threadOtherParty = null,
}: {
  body: string;
  members: readonly ChannelMember[];
  /**
   * The room's live agents. ⚠ **IN THE ORDER THE CALLER HOLDS THEM, AND THE
   * ORDER IS LOAD-BEARING** — RR3's last arm is "the first candidate", which the
   * server resolves as *most recently launched*. The peer projection arrives
   * newest-change-first, which is this surface's closest answer to that.
   */
  sessions: readonly LiveAgentSession[];
  /** ⚠ Dropped from the recipients: you do not tag yourself, and the server
   *  excludes the author from the stamped set. */
  currentUserId: string;
  defaultResponderAgentName?: string | null;
  /**
   * RR3 arm 3's answer — **the agents THIS USER has ADDRESSED in this room, most recent first**,
   * from `lib/agent-post-stamp.ts › recentAgentsAddressedBy` over the transcript this pane is
   * already rendering.
   * ⚠ **IT CREDITED `recentAgentPosters` UNTIL 2026-09-06 AND THAT WAS STALE BY TWO DAYS.** The arm
   * stopped reading "who posted here lately" on 2026-09-04 (an agent tagging another agent moved
   * every member's default); it reads the caller's own typed tags now.
   * ⚠ **AND THERE IS NO TIME WINDOW ON IT** (Samuel, 2026-09-06): the agent you last addressed
   * holds until you address a different live agent or that one ends. Liveness is settled below,
   * against the sessions the caller passes — an ended agent is simply not a candidate.
   * ⚠ **THE SERVER ASKS THE SAME FUNCTION OF A BOUNDED `channel_messages` READ**, so the two agree
   * by construction rather than by coincidence; `[]` degrades to arm 4.
   */
  recentAgentIds?: readonly string[];
  /** RR1's answer, when the composer is inside a thread. `null` in the main
   *  room, and `null` for a thread whose other party is unknown. */
  threadOtherParty?: ChannelMember | null;
}): DraftReach {
  const candidates = liveAgentCandidates(sessions);
  const index = buildAgentMentionIndex(candidates);
  const byId = new Map(candidates.map((c) => [c.agentId, c]));

  const recipients: DraftRecipient[] = [];
  const seen = new Set<string>();
  for (const token of mentionTokensOf(body)) {
    const handle = mentionHandleOf(token);
    const agentId = resolveAgentHandle(handle, index);
    if (agentId === null || seen.has(agentId)) continue;
    seen.add(agentId);
    recipients.push(agentRecipient(agentId, byId.get(agentId)));
  }
  for (const userId of resolveMentions(body, members)) {
    if (userId === currentUserId) continue;
    const member = members.find((m) => m.userId === userId);
    if (!member) continue;
    recipients.push({ kind: "member", userId, label: memberLabel(member) });
  }
  if (recipients.length > 0) return { recipients, via: "tagged", reason: null };

  // ── RR1 — a thread reply with no address goes to the other party. ──────────
  if (threadOtherParty !== null) {
    return {
      recipients: [
        {
          kind: "member",
          userId: threadOtherParty.userId,
          label: memberLabel(threadOtherParty),
        },
      ],
      via: "thread",
      reason: null,
    };
  }

  // ── RR3 — the channel's responder, its one live agent, else who spoke last. ─
  const responder = resolveDefaultResponder(
    defaultResponderAgentName,
    candidates,
    recentAgentIds
  );
  if (responder === null) return NOBODY;
  return {
    recipients: [agentRecipient(responder.agentId, byId.get(responder.agentId))],
    via: "responder",
    reason: responder.reason,
  };
}

/**
 * ⚠ **AN AGENT IS SHOWN BY ITS HANDLE, NOT BY ITS FRIENDLY NAME, AND THAT IS THE
 * WHOLE TEACHING HALF OF THIS LINE.** The name is what a reader would have
 * guessed at; the handle is what the resolver accepts and what the picker just
 * put in the draft, so showing it is what closes the loop Samuel described. A
 * renamed agent's handle IS its slugged name (`@research-bot`), so nothing is
 * lost by preferring it.
 */
function agentRecipient(
  agentId: string,
  candidate: AgentMentionCandidate | undefined
): DraftRecipient {
  const handle = agentMentionHandle(candidate ?? { agentId });
  return { kind: "agent", agentId, handle, label: `@${handle}` };
}

/**
 * **RR1's PARTY, FROM THE THREAD ROW** — the exchange's other member, or `null`.
 *
 * ⚠ **IT MIRRORS `server/service-wake-verdict-resilience.ts › threadOtherParty`
 * EXACTLY, INCLUDING ITS THIRD ARM.** The server reads the fold's own
 * `taskCreatedBy` / `taskTarget` stamps and answers nobody when the author is
 * neither — a legacy `task-` tag, or an unaddressed thread. A client cannot see
 * those stamps, so it asks the same question of the thread ROW the pane is
 * already rendering; the two agree because the stamps are re-written FROM that
 * row (fold 3).
 *
 * ⚠ **A MEMBER THE ROSTER HAS NOT LOADED YET IS `null`, NOT A BLANK NAME.** The
 * roster and the thread are separate reads. Answering `null` degrades the line
 * to the RR3 arm, which understates the reach — the safe direction.
 *
 * ⚠ **THERE IS A SECOND COPY OF THIS PAIR IN THE TREE** —
 * `components/channels-v2/use-agents-panel.ts › launchAgent` derives the same
 * counterparty for a launch. Filed as **F-551**; folding them is a change to a
 * file this slice does not own.
 */
export function threadOtherPartyOf(
  thread: { createdBy: string; targetUserId: string | null } | null,
  members: readonly ChannelMember[],
  currentUserId: string
): ChannelMember | null {
  if (thread === null) return null;
  const other =
    thread.createdBy === currentUserId
      ? thread.targetUserId
      : thread.targetUserId === currentUserId
        ? thread.createdBy
        : null;
  if (other === null) return null;
  return members.find((m) => m.userId === other) ?? null;
}
