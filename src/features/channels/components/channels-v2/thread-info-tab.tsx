"use client";

/**
 * Channels v2 — the right panel's INFO tab WHILE A THREAD IS OPEN (Samuel,
 * 2026-08-21).
 *
 * ⚠ IT REPLACES THE CHANNEL'S INFO TAB, IT DOES NOT EXTEND IT. In thread view the
 * whole right column is about the exchange the centre pane is showing, so the
 * channel's creator / roster / heatmap have no business standing in it —
 * `info-tab.tsx` is untouched and still renders verbatim in channel view. The
 * two are separate files rather than one branching component because they answer
 * two different questions and will drift apart on purpose.
 *
 * WHAT A THREAD ACTUALLY IS, and therefore what this can honestly show: a titled,
 * mode-tagged exchange between EXACTLY TWO parties (INVARIANTS §5) — the member
 * who opened it and the member it was addressed to. Everything below is one of
 * those five facts or a live agent standing on the exchange.
 *
 * ⚠ NO STATUS ROW, and its absence is the point. A thread has no finished state
 * anywhere in the product (INVARIANTS §5), so a "Status" line here would have to
 * invent one — the channel's Info tab has that row because a CHANNEL is
 * archivable and a thread is not.
 *
 * ⚠ PRESENCE IS CLIENT-SIDE ARITHMETIC over `lastSeenAt`, exactly as the roster
 * does it (`view-model.ts › isPresent`) — never the DTO's server-time verdict, so
 * a stale read fails toward OFFLINE.
 *
 * ⚠ THE AGENTS SECTION RUNS THE TAB ROW'S OWN DERIVATIONS (`ownAgentsFor` /
 * `peerCardsFor`) rather than a third filter written here. A second copy of those
 * predicates is F-142's defect wearing a different hat: this list and the Agents
 * tab's badge would answer "who is on this thread" differently, with nothing
 * saying which is right.
 */

import { Bot, Calendar, Hash, Radio, UserRound, Users } from "lucide-react";
import { AvatarWithPresence } from "@/shared/ui/avatar-with-presence";
import { formatShortDate } from "@/shared/lib/format-time";
import { cn } from "@/shared/lib/utils";
import { THREAD_MODE_LABELS } from "../../constants";
import type { DesktopSessionSummary } from "@/shared/lib/spa-bridge";
import type { ChannelPeerSession } from "../../hooks/use-channel-agent-sessions";
import type { ChannelMember, ChannelThread } from "../../types";
import { MetaRow, MetaRowDivider, PanelHeading } from "./bits";
import { AgentLiveness } from "./agent-bits";
import {
  agentDisplayId,
  agentKey,
  agentLiveness,
  ownAgentsFor,
  peerCardsFor,
  type AgentLivenessState,
} from "./agents-model";
import { isPresent, memberPerson } from "./view-model";

// ⚠ `MODE_LABEL` STOOD HERE and is now `constants.ts › THREAD_MODE_LABELS`
// (2026-08-21). Same two words; it moved because the thread SETTINGS tab
// (`thread-settings-tab.tsx`) now lets the creator CHOOSE the mode, and a
// display map beside a control map is two places for one value to be worded.

export function ThreadInfoTab({
  thread,
  members,
  currentUserId,
  agentSessions,
  peerSessions = [],
}: {
  thread: ChannelThread;
  /** The channel roster — the two parties are resolved through it. */
  members: ChannelMember[];
  currentUserId: string;
  /** THIS MACHINE'S live feed, or `null` for "could not ask". ⚠ Carried as
   *  `null`, never collapsed to `[]`: the section words the two differently. */
  agentSessions: readonly DesktopSessionSummary[] | null;
  /** Every member's session STATE for this channel (the server projection). */
  peerSessions?: readonly ChannelPeerSession[];
}) {
  const byUser = new Map(members.map((m) => [m.userId, m]));
  const opener = byUser.get(thread.createdBy) ?? null;
  const addressee = thread.targetUserId
    ? (byUser.get(thread.targetUserId) ?? null)
    : null;

  const mine = agentSessions
    ? ownAgentsFor(agentSessions, thread.channelId, thread.id)
    : [];
  const peers = peerCardsFor(peerSessions, currentUserId, thread.id);
  const agentCount = agentSessions === null ? null : mine.length + peers.length;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto pb-6">
      <PanelHeading title="Thread info" />
      <div className="px-2">
        <MetaRow icon={Hash} label="Title">
          <span
            title={thread.title}
            className="max-w-[180px] truncate text-body text-text-primary"
          >
            {thread.title}
          </span>
        </MetaRow>
        <MetaRowDivider />
        <MetaRow icon={Radio} label="Mode">
          <span className="text-body text-text-primary">
            {THREAD_MODE_LABELS[thread.mode]}
          </span>
        </MetaRow>
        <MetaRowDivider />
        <MetaRow icon={Calendar} label="Date of creation">
          <span className="text-body text-text-primary">
            {formatShortDate(thread.createdAt)}
          </span>
        </MetaRow>
      </div>

      {/* ⚠ TWO PARTIES, NAMED BY THEIR SIDE OF THE EXCHANGE. Not a roster slice:
          a thread's parties are fixed at open, so this list neither grows with
          the channel nor drops a member who left it. */}
      <PanelHeading title="Parties" />
      <div className="flex flex-col gap-px px-2">
        <PartyRow member={opener} side="Opened by" fallbackIcon={UserRound} />
        <PartyRow
          member={addressee}
          side="Addressed to"
          fallbackIcon={Users}
          // ⚠ A thread with no `targetUserId` is a real row, not a broken one,
          // and it reads as an ABSENT addressee rather than as a missing person.
          missing={thread.targetUserId ? "Not in this channel" : "No addressee"}
        />
      </div>

      <PanelHeading
        title="Agents"
        trailing={
          // ⚠ NO NUMBER WHEN THE FEED COULD NOT BE ASKED. A `0` beside this
          // heading is a confident claim about the operator's own machine that a
          // plain browser cannot make (INVARIANTS §11 — UNKNOWN is not EMPTY).
          agentCount === null ? undefined : (
            <span className="text-caption text-text-muted">{agentCount}</span>
          )
        }
      />
      <div className="flex flex-col gap-px px-2">
        {mine.map((agent) => (
          <AgentStateRow
            key={agentKey(agent)}
            label={agentDisplayId(agent)}
            sub="Yours"
            liveness={agentLiveness(agent)}
          />
        ))}
        {peers.map((peer) => (
          <AgentStateRow
            key={`${peer.userId}:${peer.name}:${peer.threadId ?? ""}`}
            label={peer.name}
            sub={`${byUser.get(peer.userId)?.displayName || "A teammate"}'s`}
            // ⚠ NOTHING FINER FOR A PEER: the cross-machine wire carries the
            // coarse state alone, so the shared mapping degrades it to the two
            // coarse words rather than inventing a third.
            liveness={agentLiveness(peer)}
          />
        ))}
        {agentSessions === null ? (
          <p className="px-2 py-2 text-caption text-text-muted">
            Your agents need the Dopl desktop app.
          </p>
        ) : (
          agentCount === 0 && (
            <p className="px-2 py-2 text-caption text-text-muted">
              No agents on this thread.
            </p>
          )
        )}
      </div>
    </div>
  );
}

/**
 * One party of the exchange, on the roster row's own recipe (`info-tab.tsx ›
 * MemberRow`): `AvatarWithPresence`'s ring for presence — the kit's recipe, never
 * a standalone dot — the member's email as the subline, and a chip stating which
 * side of the thread they are.
 *
 * ⚠ AN UNRESOLVED PARTY RENDERS AS AN ABSENCE, NEVER AS A UUID. A member who left
 * the workspace has no roster row, and an id is not a name (the same rule the
 * channel Info tab's Creator row follows, and `view-model.ts › threadParties`
 * enforces on its own list by dropping such ids outright).
 */
function PartyRow({
  member,
  side,
  missing = "Not in this channel",
  fallbackIcon: Fallback,
}: {
  member: ChannelMember | null;
  side: string;
  missing?: string;
  fallbackIcon: typeof UserRound;
}) {
  if (!member) {
    return (
      <div className="flex h-[46px] items-center gap-2.5 rounded-[8px] px-2">
        <Fallback size={16} aria-hidden className="shrink-0 text-text-muted" />
        <span className="min-w-0 flex-1 truncate text-body text-text-muted">
          {missing}
        </span>
        <SidePill label={side} />
      </div>
    );
  }
  const online = isPresent(member);
  return (
    <div
      className={cn(
        "flex h-[46px] items-center gap-2.5 rounded-[8px] px-2",
        !online && "opacity-60"
      )}
    >
      <AvatarWithPresence
        person={memberPerson(member)}
        online={online}
        size="sm"
        title={online ? "Agent listening" : "Agent offline"}
      />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-body font-semibold text-text-primary">
          {member.displayName ?? member.email ?? "Member"}
        </span>
        {member.email && (
          <span className="truncate text-caption text-text-muted">
            {member.email}
          </span>
        )}
      </span>
      <SidePill label={side} />
    </div>
  );
}

/** Which side of the exchange this party is. ⚠ NOT `bits.tsx › RolePill` — that
 *  states the CHANNEL role (owner / member), which is a different fact and would
 *  read as a claim about permissions on the thread. */
function SidePill({ label }: { label: string }) {
  return (
    <span className="shrink-0 rounded-full border border-border-strong bg-bg-inset px-2 py-px text-micro font-medium text-text-secondary">
      {label}
    </span>
  );
}

/** One live agent standing on this thread: its ID and what it is doing. The
 *  Agents tab owns the CARD with the meters; this is the glance. */
function AgentStateRow({
  label,
  sub,
  liveness,
}: {
  label: string;
  sub: string;
  /** From the ONE mapping (`agents-model.ts › agentLiveness`) — this row states
   *  a verdict, it does not compute one. */
  liveness: AgentLivenessState;
}) {
  return (
    <div className="flex h-[38px] items-center gap-2 rounded-[8px] px-2">
      <Bot size={14} aria-hidden className="shrink-0 text-text-muted" />
      <span className="min-w-0 truncate text-body text-text-primary">{label}</span>
      <span className="shrink-0 text-caption text-text-muted">{sub}</span>
      <span className="flex-1" />
      <AgentLiveness {...liveness} />
    </div>
  );
}
