"use client";

/**
 * STAGING COPY of `marketing/components/banner-demo/demo-agent-card.tsx`. Changes (marked
 * STAGING): a card's "Open" opens THAT agent (`onOpenAgent(agentKey)`; the demo has one
 * agent to open), and faces/labels resolve through `../data/staging-agents.ts`.
 *
 * --- original docblock ---
 *
 * **THE AGENTS-TAB CARD, REDESIGNED FOR THE BANNER DEMO ONLY** (Samuel, 2026-10-22: "edit
 * the UI of the agent card in the agents tab").
 *
 * ⚠ **THE PRODUCT CARDS ARE UNTOUCHED.** `channels/components/agents-tab-cards.tsx ›
 * AgentCard` / `PeerCards` still render inside the real `ChannelsInfoPanel`;
 * {@link DemoAgentCards} hides each one and portals this face after it (`demo-swap.ts`).
 * The look is the Orchestration rail card's (`ontology-agent-rail.tsx`): a white card on a
 * hairline, a PairedAvatar, the status as a dot + word, context as a thin meter with the
 * value right-aligned, and tokens spent muted.
 *
 * Same facts, read through the product's own helpers: name, liveness, where it works
 * ("↳ thread · identity"), context used of the window, tokens spent, and Open / Viewing.
 */

import { useMemo, type RefObject } from "react";
import { createPortal } from "react-dom";
import { Trash2 } from "lucide-react";
import type { DesktopSessionSummary } from "@/shared/lib/spa-bridge";
import type { ChannelPeerSession } from "@/features/channels/hooks/use-channel-agent-sessions";
import type { AuthorIndex } from "@/features/channels/components/view-model";
import {
  type AgentLivenessState,
  agentDisplayName,
  agentKey,
  agentLiveness,
  agentPermissionLabel,
  agentRunningModel,
  NO_THREAD_LABEL,
  peerRowStale,
} from "@/features/channels/components/agents-model";
import { metric } from "@/features/channels/components/agent-metrics";
import { agentModelShortLabel } from "@/features/channels/lib/agent-models";
import { agentColorVar } from "@/features/channels/lib/agent-colors";
import type { AgentColorKey } from "@dopl/contracts";
import { formatTokens } from "@/shared/lib/format-tokens";
import { PairedAvatar } from "@/features/onboarding/components/paired-avatar";
import { colorSlot, useDemoSwap } from "@/features/marketing/components/banner-demo/demo-swap";
import {
  stagingAgentIdByLabel as agentIdByLabel,
  stagingIdentityFace as identityFace,
} from "../data/staging-agents";

type Face = { photo: string | null; color: AgentColorKey | null; logo: string };

function Status({ tone, label }: AgentLivenessState) {
  return (
    <span className="lp-demo-ac-status" data-tone={tone}>
      <i />
      {label}
    </span>
  );
}

function Head({
  face,
  name,
  liveness,
}: {
  face: Face;
  name: string;
  liveness: AgentLivenessState;
}) {
  return (
    <div className="lp-demo-ac-head">
      {/* 30, not 24 (ask 6d): the ring + white frame cost a fixed 4px at any size, so 24
          left a 16px photo and a ~9px runtime logo. */}
      <PairedAvatar
        d={30}
        thinFrame
        photo={face.photo ?? undefined}
        agentLogo={face.logo}
        color={colorSlot(face.color)}
      />
      <span className="lp-demo-ac-name">{name}</span>
      <Status {...liveness} />
    </div>
  );
}

export function DemoAgentCard({
  agent,
  face,
  viewing,
  onOpen,
}: {
  agent: DesktopSessionSummary;
  face: Face;
  viewing: boolean;
  onOpen: () => void;
}) {
  const used = metric(agent.contextUsed) ?? 0;
  const window = metric(agent.contextWindow) ?? 0;
  const spent = metric(agent.tokensSpent);
  const fill = window > 0 ? Math.min(1, used / window) : 0;
  const where = [
    agent.threadTitle ?? NO_THREAD_LABEL,
    agent.identityName?.trim() || null,
    agentModelShortLabel(agentRunningModel(agent), null),
    agentPermissionLabel(agent),
  ].filter(Boolean);
  return (
    <div className="lp-demo-ac" data-viewing={viewing ? "true" : undefined}>
      <Head
        face={face}
        name={agentDisplayName(agent)}
        liveness={
          agent.state === "ended"
            ? { tone: "ended", label: "Ended" }
            : agentLiveness(agent)
        }
      />
      <p className="lp-demo-ac-where">↳ {where.join(" · ")}</p>
      <p className="lp-demo-ac-row">
        Context tokens
        <span className="lp-demo-ac-value">
          {formatTokens(used)} / {formatTokens(window)}
        </span>
      </p>
      <span className="lp-demo-ac-track">
        <b
          style={{
            width: `${fill * 100}%`,
            background: face.color ? agentColorVar(face.color) : undefined,
          }}
        />
      </span>
      <div className="lp-demo-ac-foot">
        <span className="lp-demo-ac-spent">
          {spent === null
            ? "Tokens spent: not measured yet"
            : `${formatTokens(spent)} tokens spent`}
        </span>
        <span className="lp-demo-ac-trash" aria-hidden>
          <Trash2 size={12} strokeWidth={2} />
        </span>
        <button
          type="button"
          className="lp-demo-ac-btn"
          aria-current={viewing ? "true" : undefined}
          onClick={onOpen}
        >
          {viewing ? "Viewing" : "Open"}
        </button>
      </div>
    </div>
  );
}

export function DemoPeerCard({
  peer,
  face,
  ownerName,
}: {
  peer: ChannelPeerSession;
  face: Face;
  ownerName: string;
}) {
  return (
    <div className="lp-demo-ac" data-stale={peerRowStale(peer) ? "true" : undefined}>
      <Head
        face={face}
        name={peer.displayName?.trim() || peer.name}
        liveness={agentLiveness(peer)}
      />
      <p className="lp-demo-ac-where">
        ↳ {ownerName}&apos;s agent
        {peer.threadTitle ? ` · ${peer.threadTitle}` : ""}
      </p>
    </div>
  );
}

/** A card's name, as the product card prints it (`AgentName` / the peer title span). */
const cardName = (card: Element) =>
  card.querySelector(".font-semibold")?.textContent?.trim() ?? "";

/**
 * Finds every Agents-tab card in the info column, matches it to its session by the name
 * it prints, and portals the demo face after it.
 */
export function StagingAgentCards({
  paneRef,
  sessions,
  peers,
  index,
  openAgent,
  onOpenAgent,
}: {
  paneRef?: RefObject<HTMLDivElement | null>;
  sessions: readonly DesktopSessionSummary[];
  peers: readonly ChannelPeerSession[];
  index: AuthorIndex;
  /** `agentKey` of the open agent view, or `null`. */
  openAgent: string | null;
  /** STAGING: called with the card's `agentKey`. */
  onOpenAgent: (key: string) => void;
}) {
  const byName = useMemo(() => {
    const out = new Map<
      string,
      | { kind: "own"; agent: DesktopSessionSummary }
      | { kind: "peer"; peer: ChannelPeerSession }
    >();
    for (const agent of sessions) out.set(agentDisplayName(agent), { kind: "own", agent });
    for (const peer of peers)
      out.set(peer.displayName?.trim() || peer.name, { kind: "peer", peer });
    return out;
  }, [sessions, peers]);

  const swaps = useDemoSwap(
    paneRef,
    (pane) =>
      [...pane.querySelectorAll<HTMLElement>(".channel-info-slide .bento")].flatMap(
        (card) => {
          const name = cardName(card);
          return byName.has(name) ? [{ key: name, source: card }] : [];
        }
      ),
    "lp-demo-ac-host"
  );

  // Owner photo, colour and runtime badge from the one identity table (`demo-identities.ts`);
  // the owner is the session's own user, so a peer card shows its owner, not the viewer.
  const faceOf = (userId: string | null | undefined, agentId: string | null | undefined): Face => ({
    ...identityFace(agentId),
    photo: (userId ? index.byId.get(userId)?.avatarUrl : null) ?? null,
    color: (agentId ? index.agents.get(agentId)?.color : null) ?? null,
  });

  return (
    <>
      {swaps.map(({ key, host }) => {
        const hit = byName.get(key);
        if (!hit) return null;
        if (hit.kind === "own") {
          return createPortal(
            <DemoAgentCard
              agent={hit.agent}
              face={faceOf(index.currentUserId, hit.agent.agentId)}
              viewing={openAgent === agentKey(hit.agent)}
              onOpen={() => onOpenAgent(agentKey(hit.agent))}
            />,
            host,
            key
          );
        }
        const owner = index.byId.get(hit.peer.userId);
        return createPortal(
          <DemoPeerCard
            peer={hit.peer}
            face={faceOf(hit.peer.userId, hit.peer.name)}
            ownerName={owner?.displayName || "A teammate"}
          />,
          host,
          key
        );
      })}
    </>
  );
}

/** `thread-info-tab.tsx › AgentStateRow`'s root: a 38px row led by the bot glyph. */
const STATE_ROWS = ".channel-info-slide div.h-\\[38px\\]";

/**
 * The thread Info tab's Agents list ("Teardown Order Fix · Yours · Running"): each row's
 * bot glyph becomes the identity avatar (owner photo + runtime badge in the agent's
 * colour ring). Name, owner word and status are read off the product row; the agent is
 * resolved from its label (`demo-identities.ts › agentIdByLabel`).
 */
export function StagingAgentStateRows({
  paneRef,
  sessions,
  peers,
}: {
  paneRef?: RefObject<HTMLDivElement | null>;
  sessions: readonly DesktopSessionSummary[];
  peers: readonly ChannelPeerSession[];
}) {
  const swaps = useDemoSwap(
    paneRef,
    (pane) =>
      [...pane.querySelectorAll<HTMLElement>(STATE_ROWS)]
        .filter((row) => row.querySelector(":scope > svg.lucide-bot"))
        .map((source, i) => ({
          key: `${source.querySelector("span")?.textContent ?? ""}-${i}`,
          source,
        })),
    "lp-demo-asr-host"
  );
  return (
    <>
      {swaps.map(({ key, source, host }) => {
        const spans = [...source.querySelectorAll(":scope > span")];
        const label = spans[0]?.textContent?.trim() ?? "";
        const sub = spans[1]?.textContent?.trim() ?? "";
        const agentId = agentIdByLabel(label);
        const own = sessions.find((s) => s.agentId === agentId);
        const peer = peers.find((p) => p.name === agentId);
        const liveness = own
          ? agentLiveness(own)
          : peer
            ? agentLiveness(peer)
            : { tone: "idle" as const, label: spans[spans.length - 1]?.textContent ?? "" };
        const face = identityFace(agentId);
        const owner =
          sub === "Yours" ? "Yours" : `${sub.replace(/'s$/, "").split(/\s+/)[0]}'s agent`;
        return createPortal(
          <div className="lp-demo-asr">
            {/* 26, not 22 (ask 6d): the ring + white frame cost a fixed 4px at any size. */}
            <PairedAvatar
              d={26}
              thinFrame
              photo={face.photo ?? undefined}
              agentLogo={face.logo}
              color={colorSlot(face.color)}
            />
            <span className="lp-demo-asr-name">
              {(agentId && own ? agentDisplayName(own) : peer?.displayName) ?? label}
            </span>
            <span className="lp-demo-asr-sub">{owner}</span>
            <Status {...liveness} />
          </div>,
          host,
          key
        );
      })}
    </>
  );
}
