"use client";

/**
 * STAGING COPY of `marketing/components/banner-demo/demo-thread-card.tsx`, RESTRUCTURED
 * 2026-10-22 on Samuel's element-by-element review. Changes (marked STAGING): "Open thread"
 * opens THIS card's thread, "Launch agent" fires `onLaunch(threadId)`, and faces come from
 * `../data/staging-agents.ts`.
 *
 * ── WHAT THE BOX SAYS NOW, AND WHY (Samuel, 2026-10-22) ──
 * 1. **The header is the THREAD'S NAME**, at the title's size, where the literal "Agent
 *    thread" label used to sit ("'flaky test suite' should just be where you have 'agent
 *    thread', and it should keep that same large font size"). The kind is carried by the
 *    tile glyph, which is all it ever needed; a card that names its thread does not also
 *    need to announce that it is a card.
 * 2. **The opening ask is the description.** It is the only prose a reader needs to decide
 *    whether to open the thread, so it sits directly under the name, clamped.
 * 3. **The agents inside the thread are the body** ("just show what agents are inside
 *    there, which is really good"). Each is one row: identity face, name, whose agent it
 *    is. An own agent's row OPENS THAT AGENT'S VIEW on the right — the affordance replaces
 *    the launch button Samuel called out ("you can open the agent and then that will open
 *    the agent view on the right for that agent"). A peer's agent runs on their machine,
 *    so there is nothing to open and the row carries no affordance (absent, not disabled).
 * 4. **The actions left the agent rectangle** ("it doesn't make sense for the open thread
 *    button to be inside the rectangle for the agent"). They sit in the card's own footer:
 *    "Open thread" is the card's one primary action; "Launch agent" stays, understated
 *    rather than "too jacked".
 * 5. **Every box is one fixed height** (`staging.css › .uis-tc`), so a wall of them reads
 *    as a list. The agent list is the part that gives, scrolling past three.
 *
 * --- original docblock ---
 *
 * **THE AGENT THREAD CARD, REDESIGNED FOR THE BANNER DEMO ONLY** (Samuel, 2026-10-22:
 * "given the design theme of the other demo portions, and the onboarding pages, can u
 * redesign that box?").
 *
 * ⚠ **THE PRODUCT CARD IS UNTOUCHED.** `channels/components/thread-card-row.tsx ›
 * ThreadCardMessage` (the dark "Agent thread" shell) is shared with the real app on web
 * and desktop, and the message pane offers no seam to replace it. So the scene still
 * renders the product card, and {@link StagingThreadCards} hides its shell and portals this
 * face into a host right after it, inside the same row (`demo-swap.ts`). The row's attribution
 * pill, reveal motion and stick-to-bottom scroll all stay the product's own.
 */

import { useMemo, type RefObject } from "react";
import { createPortal } from "react-dom";
import { ChevronRight, MessagesSquare, Users } from "lucide-react";
import type { DesktopSessionSummary } from "@/shared/lib/spa-bridge";
import type { ChannelPeerSession } from "@/features/channels/hooks/use-channel-agent-sessions";
import type { AuthorIndex } from "@/features/channels/components/view-model";
import type {
  ThreadCardRow,
  TranscriptRow,
} from "@/features/channels/components/view-model-rows";
import {
  agentDisplayName,
  agentKey,
  agentLiveness,
  ownAgentsFor,
  peerCardsFor,
} from "@/features/channels/components/agents-model";
import { PairedAvatar } from "@/features/onboarding/components/paired-avatar";
import { colorSlot, useDemoSwap } from "@/features/marketing/components/banner-demo/demo-swap";
import { stagingIdentityFace as identityFace } from "../data/staging-agents";

/** The product shell this face replaces; `thread-card-row.tsx` is the only wearer. */
const PRODUCT_SHELL = ".bg-surface-cta.ring-surface-cta";

const STATUS_LABEL: Record<string, string> = {
  open: "Open",
  closed: "Closed",
};

/** `agents-model.ts › agentLiveness` tones that mean the agent is actually working. */
const LIVE_TONES = new Set(["working", "live"]);

function ownerLabel(authorLabel: string): string {
  if (authorLabel === "You") return "Your agent";
  const first = authorLabel.trim().split(/\s+/)[0] || "Member";
  return `${first}'s agent`;
}

/** One agent in the thread, as the card draws it. */
export interface ThreadCardAgent {
  key: string;
  name: string;
  /** "Yours" / "Grace's agent" — who it belongs to. */
  owner: string;
  photo: string | null;
  color: string | null;
  logo: string;
  state: { tone: string; label: string };
  /** Own agents only: opens the agent view on the right. Peers run elsewhere. */
  onOpen?: () => void;
}

function AgentRow({ agent }: { agent: ThreadCardAgent }) {
  const inner = (
    <>
      {/* 26, not 22 (ask 6d): the ring and frame cost a fixed 4px at any size, so 22 left a
          14px photo. 26 keeps the row's rhythm and makes the face readable. */}
      <PairedAvatar
        d={26}
        thinFrame
        photo={agent.photo ?? undefined}
        agentLogo={agent.logo}
        color={colorSlot(agent.color)}
      />
      <span className="uis-tc-agent-who">
        <span className="uis-tc-agent-name">{agent.name}</span>
        <span className="uis-tc-agent-owner">{agent.owner}</span>
      </span>
      <span className="uis-tc-agent-state" data-tone={agent.state.tone}>
        <i />
        {agent.state.label}
      </span>
      {agent.onOpen && (
        <ChevronRight size={13} strokeWidth={2.2} aria-hidden className="uis-tc-agent-go" />
      )}
    </>
  );
  // Absent, not disabled: a peer's agent is a plain row, the same shape without the press.
  if (!agent.onOpen) {
    return <div className="uis-tc-agent">{inner}</div>;
  }
  return (
    <button
      type="button"
      className="uis-tc-agent"
      aria-label={`Open ${agent.name}`}
      onClick={agent.onOpen}
    >
      {inner}
    </button>
  );
}

export function StagingThreadCard({
  row,
  agents,
  onOpen,
  onLaunch,
}: {
  row: ThreadCardRow;
  /** Every agent working this thread, own ones first. */
  agents: ThreadCardAgent[];
  onOpen: () => void;
  /** STAGING: the in-memory launch. */
  onLaunch?: () => void;
}) {
  const thread = row.threads[0];
  const status = STATUS_LABEL[thread.status] ?? thread.status;
  const running = agents.filter((a) => LIVE_TONES.has(a.state.tone)).length;
  return (
    <div className="lp-demo-tc uis-tc">
      <div className="lp-demo-tc-head">
        <span className="uis-tc-name">
          <span className="lp-demo-tc-kind-tile">
            <MessagesSquare size={11} strokeWidth={2.2} aria-hidden />
          </span>
          <span className="uis-tc-name-text">{thread.title}</span>
        </span>
        <span className="lp-demo-tc-status" data-status={thread.status}>
          <i />
          {status}
        </span>
      </div>

      <p className="lp-demo-tc-preview uis-tc-desc">{row.preview}</p>

      {/* ⚠ A WELL, NOT THREE STACKED LINES (structure before font styling, whose first named
          instance is this box with no agents: opening ask, "no agents yet" and "opened by"
          sat on top of each other in three font stylings with no skeleton). The agents are
          a COMPARTMENT now — the demo card's own grey well recipe (`.lp-demo-tc-well`),
          reused — so the empty state is a shape with something in it rather than another
          line of text, and the footer is fenced off by a rule below. */}
      <div className="uis-tc-agents">
        {agents.length === 0 ? (
          <p className="uis-tc-agents-empty">
            <Users size={13} strokeWidth={2} aria-hidden />
            No agents yet
          </p>
        ) : (
          <>
            {/* The count, and what the far side of that line is for (the Blank Space Rule: move a real
                fact into the slack rather than leave a label with a blank majority). How
                many are actually running is derived, not invented. */}
            <p className="uis-tc-agents-head">
              <span>
                {agents.length} agent{agents.length === 1 ? "" : "s"} in this thread
              </span>
              {running > 0 && <span className="uis-tc-agents-live">{running} running</span>}
            </p>
            <div className="uis-tc-agent-list">
              {agents.map((agent) => (
                <AgentRow key={agent.key} agent={agent} />
              ))}
            </div>
          </>
        )}
      </div>

      <div className="uis-tc-foot">
        <span className="uis-tc-by">Opened by {ownerLabel(row.authorLabel)}</span>
        <span className="lp-demo-tc-actions">
          <button
            type="button"
            className="lp-demo-tc-btn uis-tc-quiet"
            onClick={onLaunch}
          >
            Launch agent
          </button>
          <button
            type="button"
            className="lp-demo-tc-btn lp-demo-tc-btn--ink"
            onClick={onOpen}
          >
            Open thread
          </button>
        </span>
      </div>
    </div>
  );
}

/**
 * Finds each thread card's row in the pane and portals {@link StagingThreadCard} after the
 * product shell (`demo-swap.ts`).
 */
export function StagingThreadCards({
  paneRef,
  rows,
  index,
  channelId,
  sessions,
  peers,
  onOpenThread,
  onOpenAgent,
  onLaunchAgent,
}: {
  paneRef?: RefObject<HTMLDivElement | null>;
  rows: readonly TranscriptRow[];
  index: AuthorIndex;
  channelId: string;
  /** The viewer's own live agents, and the other members' (`agents-model.ts`). */
  sessions: readonly DesktopSessionSummary[];
  peers: readonly ChannelPeerSession[];
  /** STAGING: called with the card's thread id. */
  onOpenThread: (threadId: string) => void;
  /** STAGING: opens an own agent's view on the right (`agentKey`). */
  onOpenAgent?: (key: string) => void;
  onLaunchAgent?: (threadId: string) => void;
}) {
  const cards = useMemo(
    () => rows.filter((r): r is ThreadCardRow => r.kind === "thread-card"),
    [rows]
  );
  const swaps = useDemoSwap(
    paneRef,
    (pane) =>
      cards.flatMap((card) => {
        const shell = pane
          .querySelector(`[data-message-id="${card.id}"]`)
          ?.querySelector<HTMLElement>(PRODUCT_SHELL);
        return shell ? [{ key: card.id, source: shell }] : [];
      }),
    "lp-demo-tc-host"
  );

  const byId = useMemo(() => new Map(cards.map((c) => [c.id, c])), [cards]);

  /**
   * Who is working one thread: the viewer's own sessions scoped to it, then the other
   * members'. Both derivations are the product's own (`agents-model.ts`), never a filter
   * written here, so the card agrees with the Agents tab.
   */
  const agentsIn = (threadId: string): ThreadCardAgent[] => {
    const own = ownAgentsFor(sessions, channelId, threadId).map((s) => ({
      key: agentKey(s),
      name: agentDisplayName(s),
      owner: "Yours",
      photo: (index.currentUserId ? index.byId.get(index.currentUserId)?.avatarUrl : null) ?? null,
      color: (s.agentId ? index.agents.get(s.agentId)?.color : null) ?? null,
      logo: identityFace(s.agentId).logo,
      state: agentLiveness(s),
      onOpen: onOpenAgent ? () => onOpenAgent(agentKey(s)) : undefined,
    }));
    const theirs = peerCardsFor(peers, index.currentUserId, threadId).map((p) => {
      const owner = index.byId.get(p.userId)?.displayName ?? "A teammate";
      return {
        key: `peer:${p.userId}:${p.name}`,
        name: p.displayName?.trim() || p.name,
        owner: `${owner.split(/\s+/)[0]}'s agent`,
        photo: index.byId.get(p.userId)?.avatarUrl ?? null,
        color: (index.agents.get(p.name)?.color ?? p.color) || null,
        logo: identityFace(p.name).logo,
        state: agentLiveness(p),
      };
    });
    return [...own, ...theirs];
  };

  return (
    <>
      {swaps.map(({ key: id, host: el }) => {
        const row = byId.get(id);
        if (!row) return null;
        const threadId = row.threads[0].id;
        return createPortal(
          <StagingThreadCard
            row={row}
            agents={agentsIn(threadId)}
            onOpen={() => onOpenThread(threadId)}
            onLaunch={() => onLaunchAgent?.(threadId)}
          />,
          el,
          id
        );
      })}
    </>
  );
}
