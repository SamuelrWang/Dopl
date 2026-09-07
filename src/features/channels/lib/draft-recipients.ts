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
 * ⚠ **RR3 IS THREE ARMS SINCE 2026-09-07, NOT FOUR** — the CONFIGURED-handle arm
 * went with the room-wide `default_responder_agent_name` (items 10 and 11), and
 * what stands in front of the rest is the asking person's own two-valued rule.
 * `"none"` is now a real answer this line must render, and it is the one case
 * where `via: "none"` means a setting was honoured rather than nobody being
 * reachable.
 *
 * ⚠ **RR3'S REMAINING ARMS ARE ALL OF THEM SINCE 2026-09-04, INCLUDING THE TWO THAT
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
  buildAgentMentionIndex,
  insertableAgentHandle,
  resolveAgentHandle,
  normalizeUnaddressedResponder,
  resolveDefaultResponder,
  type AgentMentionCandidate,
  type AgentMentionIndex,
  type ResponderReason,
  type UnaddressedResponderSetting,
} from "./agent-mentions";
import {
  memberHandlesOf,
  mentionHandleOf,
  mentionTokensOf,
  resolveMentions,
} from "./mentions";
import type { ChannelMember } from "../types";

/**
 * **THE VIEWER'S OWN "who answers my untagged messages" SETTING, OUT OF THE ROSTER THIS
 * SURFACE ALREADY HOLDS** (2026-09-07, Samuel's ruling on items 10 and 11).
 *
 * ⚠ **IT IS THE CLIENT'S ONLY SOURCE FOR THAT SETTING, AND THAT IS WHY IT IS A FUNCTION.** The
 * composer's recipient line and the Settings control both have to answer "which row is mine"
 * and "what does an absent one mean", and two spellings of those is how a control comes to
 * report something the line does not predict. It lives in THIS module rather than a new one
 * because there is one field to read and a module for one field is a split nobody asked for.
 *
 * ⚠ **A ROSTER THAT HAS NOT LOADED IS THE DEFAULT, NEVER `"none"`** — the fail-safe direction
 * is the ruling itself (`normalizeUnaddressedResponder`, and the server's
 * `unaddressedResponderFor` fails the same way). ⚠ **AND THE RESIDUAL IS STATED RATHER THAN
 * HIDDEN**: for a member who chose `"none"`, a not-yet-loaded roster makes the line name a
 * responder the server will NOT wake — an OVERSTATEMENT, which is the direction this file
 * calls worse than no line at all. It is bounded to the roster's first paint (the same read
 * the @-picker and the member-mention resolver already block on), and the way to close it
 * completely is a `Channel.my*` projection off the channel list; that is a second client-side
 * source of one value, which is the trade recorded here for whoever rules on it.
 */
export function viewerUnaddressedResponder(
  members: readonly ChannelMember[],
  currentUserId: string
): UnaddressedResponderSetting {
  const me = members.find((m) => m.userId === currentUserId);
  // ⚠ `?? undefined` DELIBERATELY LOSES THE NULL. On a PEER's row `null` means "not yours to
  // see"; on your own row the mapper never writes one. Either way the coercion below must read
  // it as "no value here", and passing `null` through would invite a future reader to treat the
  // privacy scrub as a setting.
  return normalizeUnaddressedResponder(me?.unaddressedResponder ?? undefined);
}

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
 * **THE COMPOSER'S ONE AGENT-HANDLE INDEX — built here so the three surfaces on that card
 * cannot answer one token three ways** (2026-09-07).
 *
 * ⚠ **THE CARD ASKS THIS QUESTION THREE TIMES AND MUST GET ONE ANSWER.** {@link draftReach}
 * predicts the reach, `composer-mentions.tsx` offers and INSERTS a handle, and
 * `composer-tint.tsx` tints a token blue as it is typed. Until this existed the picker built its
 * own index with NO reserved set, so an agent an operator named "Diana" was offered `@diana`
 * while the recipient line — reserving the member namespace — had already minted it `diana-1`:
 * the picker inserted a token that tagged the MEMBER and the line named neither. One builder,
 * one answer.
 *
 * ⚠ **THE RESERVED SET IS THE WHOLE POINT OF THE MEMBERS ARGUMENT** — members outrank agents
 * (Samuel's suffix ruling), and a surface holding a roster has no excuse to skip it.
 */
export function draftAgentIndex(
  candidates: readonly AgentMentionCandidate[],
  members: readonly ChannelMember[]
): AgentMentionIndex {
  return buildAgentMentionIndex(candidates, memberHandlesOf(members));
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
 *  - `responder` — nobody was addressed and RR3 answered (the room's one live
 *                  agent, the one this person addressed last, or the one
 *                  launched last). ⚠ Never reached at all when this person's own
 *                  setting is `"none"`; the line then reads `none`, which is the
 *                  selection being honoured rather than a failure.
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
  unaddressedResponder,
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
  /**
   * **THE ASKING PERSON'S OWN SETTING** (2026-09-07, items 10 and 11) — this parameter replaced
   * `defaultResponderAgentName`, the channel's room-wide pin of one agent for everybody.
   * `viewerUnaddressedResponder` above is how a surface with a roster answers it.
   *
   * ⚠ **REQUIRED, AND NOT OPTIONAL-WITH-A-DEFAULT, WHICH IS A CHANGE OF DIRECTION WORTH
   * NAMING.** The old parameter was optional because omitting it merely skipped arm 1 and
   * UNDERSTATED the reach — this file's safe direction. Omitting THIS one would land on
   * `"last_addressed"` and make the line name a responder for somebody who chose "No one",
   * which OVERSTATES: it tells a guest their message was seen. So the compiler asks every
   * surface, rather than a default answering quietly on its behalf.
   *
   * ⚠ **NON-NULLABLE, AND THE CALLER COERCES** — the server's `defaultResponder` takes exactly
   * the same shape for exactly the same reason: "I could not read the setting" must not be
   * spellable as "the user chose nobody".
   */
  unaddressedResponder: UnaddressedResponderSetting;
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
  // ⚠ **THE MEMBER NAMESPACE IS RESERVED AGAINST THE AGENT ONE** (2026-09-07, Samuel's suffix
  // ruling: members outrank agents). Both namespaces are resolved over ONE body a few lines
  // apart in this very function, so an agent named after a member would otherwise claim the
  // same token here that `resolveMentions` claims below — and which answer a reader got would
  // depend on which loop ran first. The member keeps the bare tag; the agent is minted `-1`.
  // ⚠ VIA {@link draftAgentIndex} SINCE 2026-09-07, so the picker and the tint build the same
  // index rather than three callers each remembering to pass the reserved set.
  const index = draftAgentIndex(candidates, members);
  const byId = new Map(candidates.map((c) => [c.agentId, c]));

  const recipients: DraftRecipient[] = [];
  const seen = new Set<string>();
  for (const token of mentionTokensOf(body)) {
    const handle = mentionHandleOf(token);
    const agentId = resolveAgentHandle(handle, index);
    if (agentId === null || seen.has(agentId)) continue;
    seen.add(agentId);
    recipients.push(agentRecipient(agentId, byId.get(agentId), index));
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

  // ── RR3 — the asking person's own rule, its one live agent, else who spoke last. ─
  // ⚠ `"none"` SHORT-CIRCUITS INSIDE `resolveDefaultResponder`, on its first line, and it is
  // NOT re-tested here. One short-circuit, in the shared rule both trees drive, is what makes
  // "must not fire ANYWHERE" enforceable rather than remembered at each caller.
  const responder = resolveDefaultResponder(
    unaddressedResponder,
    candidates,
    recentAgentIds
  );
  if (responder === null) return NOBODY;
  return {
    recipients: [agentRecipient(responder.agentId, byId.get(responder.agentId), index)],
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
  candidate: AgentMentionCandidate | undefined,
  /** ⚠ **THE INDEX, NOT JUST THE CANDIDATE, SINCE 2026-09-07** — see below. */
  index: AgentMentionIndex
): DraftRecipient {
  // ⚠ **`agentMentionHandle` WAS WRONG HERE THE MOMENT SUFFIXES EXISTED.** It answers a
  // candidate's PREFERRED spelling knowing nothing of the room, so two agents both named
  // "Coder" would each be shown `@coder` — and one of them does not hold it. The line would
  // then name a handle that reaches the OTHER agent: a row showing one name and tagging
  // somebody else, which is F-210 in the agent namespace and precisely what this line exists
  // to prevent. `insertableAgentHandle` reads back the spelling this agent actually won.
  const handle = insertableAgentHandle(candidate ?? { agentId }, index);
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
