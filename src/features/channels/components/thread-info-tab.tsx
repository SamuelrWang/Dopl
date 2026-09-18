"use client";

/**
 * Channels — the right panel's INFO tab WHILE A THREAD IS OPEN (Samuel,
 * 2026-08-21).
 *
 * ⚠ IT REPLACES THE CHANNEL'S INFO TAB, IT DOES NOT EXTEND IT: in thread view the
 * right column is about the exchange the centre pane is showing, so the channel's
 * creator / roster / heatmap have no business standing in it. Two files, not one
 * branching component, because they answer two questions and will drift on purpose.
 *
 * WHAT A THREAD ACTUALLY IS, and therefore what this can honestly show: a titled,
 * mode-tagged exchange between EXACTLY TWO parties (INVARIANTS §5).
 *
 * ⚠ NO STATUS ROW, and its absence is the point: a thread has no finished state
 * anywhere in the product (INVARIANTS §5), so the line would invent one. The
 * channel's Info tab has it because a CHANNEL is archivable.
 *
 * ⚠ PRESENCE IS **THE DTO's `agentOnline`** (`view-model.ts ›
 * isPresentForViewer`), with the viewer's own row forced online while this desktop
 * app is running. ⚠ IT WAS CLIENT-SIDE ARITHMETIC OVER `lastSeenAt` UNTIL
 * 2026-09-08, and failing toward OFFLINE was the reported defect.
 *
 * ⚠ THE AGENTS SECTION RUNS THE TAB ROW'S OWN DERIVATIONS (`ownAgentsFor` /
 * `peerCardsFor`), never a third filter here — a second copy is F-142's defect.
 */

import { Bot, Calendar, Hash, Radio, UserRound, Users } from "lucide-react";
import { AvatarWithPresence } from "@/shared/ui/avatar-with-presence";
import { formatDate } from "@/shared/lib/format-time";
import { cn } from "@/shared/lib/utils";
import { THREAD_MODE_LABELS } from "../constants";
import type { DesktopSessionSummary } from "@/shared/lib/spa-bridge";
import type { ChannelPeerSession } from "../hooks/use-channel-agent-sessions";
import { CREATED_ROW_LABEL } from "../lib/channel-display";
import type { ChannelMember, ChannelThread } from "../types";
import { MetaRow, MetaRowDivider, PanelHeading } from "./bits";
import { AgentLiveness } from "./agent-bits";
import {
  agentDisplayName,
  agentKey,
  agentLiveness,
  ownAgentsFor,
  peerCardsFor,
  type AgentLivenessState,
} from "./agents-model";
import { isPresentForViewer, memberPerson } from "./view-model";

// ⚠ `MODE_LABEL` STOOD HERE and is now `constants.ts › THREAD_MODE_LABELS`
// (2026-08-21): `thread-settings-tab.tsx` lets the creator CHOOSE the mode, and a
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
        {/* ⚠ **"Created" + `formatDate` — THE SAME ROW THE TWO CHANNEL BODIES
            READ (Samuel, 2026-09-17, extending his ruling R-20 to the thread on
            F-722's ask).** This row said **"Date of creation"** with
            `formatShortDate` while the channel bodies said "Created" with
            `formatDate`, one selection away in the same column, with the same
            `Calendar` glyph — R-20 closed a channel-vs-home split and left a
            channel-vs-thread one, which is what F-722 recorded rather than swept.
            ⚠ **THE CONSTANT IS IMPORTED, NOT RETYPED** (`channel-display.ts ›
            CREATED_ROW_LABEL`): two literals is exactly how the first divergence
            happened. ⚠ **THE FORMATTER KEEPS THE YEAR** — `formatShortDate` drops
            it, and on a creation date that is the component that matters.
            ⚠ **THE SOURCE IS STILL THIS OBJECT'S OWN** (`thread.createdAt`); the
            label and the formatter are shared, the row is not. */}
        <MetaRow icon={Calendar} label={CREATED_ROW_LABEL}>
          <span className="text-body text-text-primary">
            {formatDate(thread.createdAt)}
          </span>
        </MetaRow>
      </div>

      {/* ⚠ TWO PARTIES, NAMED BY THEIR SIDE OF THE EXCHANGE — not a roster slice:
          they are fixed at open, so this list neither grows with the channel nor
          drops a member who left it. */}
      <PanelHeading title="Parties" />
      <div className="flex flex-col gap-px px-2">
        <PartyRow
          member={opener}
          side="Opened by"
          fallbackIcon={UserRound}
          viewerUserId={currentUserId}
        />
        <PartyRow
          member={addressee}
          side="Addressed to"
          fallbackIcon={Users}
          viewerUserId={currentUserId}
          // ⚠ A thread with no `targetUserId` is a real row, not a broken one,
          // and it reads as an ABSENT addressee rather than as a missing person.
          missing={thread.targetUserId ? "Not in this channel" : "No addressee"}
        />
      </div>

      <PanelHeading
        title="Agents"
        trailing={
          // ⚠ NO NUMBER WHEN THE FEED COULD NOT BE ASKED — a `0` here is a claim
          // about the operator's own machine that a plain browser cannot make
          // (INVARIANTS §11 — UNKNOWN is not EMPTY).
          agentCount === null ? undefined : (
            <span className="text-caption text-text-muted">{agentCount}</span>
          )
        }
      />
      <div className="flex flex-col gap-px px-2">
        {mine.map((agent) => (
          <AgentStateRow
            key={agentKey(agent)}
            label={agentDisplayName(agent)}
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
            // coarse state alone, and the shared mapping invents no third word.
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
 * MemberRow`): `AvatarWithPresence`'s ring for presence — never a standalone dot —
 * the email as subline, and a chip stating which side of the thread they are.
 *
 * ⚠ AN UNRESOLVED PARTY RENDERS AS AN ABSENCE, NEVER AS A UUID: an id is not a
 * name (the rule the Creator row follows, and `view-model.ts › threadParties`
 * enforces by dropping such ids outright).
 */
function PartyRow({
  member,
  side,
  missing = "Not in this channel",
  fallbackIcon: Fallback,
  viewerUserId,
}: {
  member: ChannelMember | null;
  side: string;
  missing?: string;
  fallbackIcon: typeof UserRound;
  /** The viewer, so their own party row cannot show them offline while their
   *  desktop app is open (`view-model.ts › isPresentForViewer`, 2026-09-08). */
  viewerUserId?: string | null;
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
  const online = isPresentForViewer(member, viewerUserId);
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
