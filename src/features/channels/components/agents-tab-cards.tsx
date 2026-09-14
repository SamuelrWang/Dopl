"use client";

/**
 * THE TWO CARD SHAPES THE AGENTS TAB DRAWS — my own agent, and a peer's — split
 * out of `agents-tab.tsx` on 2026-08-22 at the 500-line cap, when the template
 * picker landed on that file's New Agent button.
 *
 * ⚠ THE SEAM IS §1's "one file, one reason to change", not the line count that
 * forced the question: `agents-tab.tsx` moves when the LAUNCH surface moves, a
 * CARD moves when the session feed's shape moves.
 *
 * ⚠ ONE CARD FACE FOR BOTH, AND FOR THREAD CARDS TOO (`bits.tsx › PANEL_CARD`).
 * The two tabs are one column and a second card shape would read as a second
 * surface.
 *
 * ⚠ EVERY NUMBER IS OPTIONAL AND EVERY ABSENCE IS RENDERED AS ONE. No meter
 * without a denominator, no "Started" without a stamp, no `0` standing in for
 * "not measured yet" (INVARIANTS §11 — UNKNOWN is not EMPTY).
 */

import { Bot, CornerDownRight } from "lucide-react";
import { AgentColorDot } from "./agent-color-dot";
import { agentColorOrNull } from "../lib/agent-colors";
import type { AgentColorKey } from "../types";
import { AgentName } from "./agent-rename";
import { AgentDeleteButton } from "./agent-delete";
import { Avatar } from "@/shared/ui/avatar";
import { UsageMeter } from "@/shared/ui/usage-meter";
import { cn } from "@/shared/lib/utils";
import type { DesktopSessionSummary } from "@/shared/lib/spa-bridge";
import type { ChannelPeerSession } from "../hooks/use-channel-agent-sessions";
import type { ChannelMember } from "../types";
import { memberPerson } from "./view-model";
import { CARD_BUTTON, PANEL_CARD } from "./bits";
import { AgentEndedPill, AgentLiveness } from "./agent-bits";
import {
  agentDisplayName,
  agentLiveness,
  agentRunningModel,
  NO_THREAD_LABEL,
  peerRowStale,
} from "./agents-model";
import { formatTokens, metric } from "./agent-metrics";
import { agentModelShortLabel } from "../lib/agent-models";

/**
 * WHAT THE OPERATOR SAID THIS AGENT IS FOR, or `null` (2026-08-27).
 *
 * ⚠ ADDITIVE AND OPTIONAL, read off a widened LOCAL type rather than declared on
 * `spa-bridge.ts › DesktopSessionSummary` — the rule `agents-model.ts › agentRunningModel` and
 * `› agentEndedAt` follow: the bridge type is the DESKTOP's to widen, the two trees ship
 * separately, and this side must behave against either version. Absent is the ORDINARY answer,
 * so the card renders nothing rather than an empty line (INVARIANTS §11).
 *
 * ⚠ IT LIVES HERE AND NOT IN `agents-model.ts`, WHICH IS AT THE 500-LINE CAP. This card is its
 * ONE consumer; move it to the projection the moment a second surface reads it.
 *
 * ⚠ MY OWN AGENTS ONLY, structurally: `main/agent-names.js` is machine-local and never reaches
 * `channel_sessions`, so a PEER row has no description to carry.
 */
function agentDescription(
  session: DesktopSessionSummary & { description?: string | null }
): string | null {
  const value = typeof session.description === "string" ? session.description.trim() : "";
  return value || null;
}

/**
 * Other members' agents — STATE ONLY, never openable (Samuel, 2026-08-20): the
 * card exists so the operator can see who else has an agent on the exchange
 * and whether it is working; nothing private is reachable from it.
 *
 * ⚠ A QUIET ROW IS DIMMED, NEVER DROPPED (Samuel, 2026-08-22): *"the card STAYS
 * until the session actually goes away."* The row's PRESENCE is the liveness
 * signal — the desktop's push replaces its whole set, so an ended session leaves
 * by omission (`agents-model.ts › peerCardsFor`). `agents-model.ts › peerRowStale`
 * answers only that the row has not MOVED lately, a weaker claim than "gone" and
 * so a weaker treatment: `opacity-60` plus the `data-stale` hook the test reads.
 * ⚠ **It is not a heartbeat** — `updated_at` moves on a state CHANGE — so a
 * perfectly live idle agent dims after 90 s.
 */
export function PeerCards({
  peers,
  byUser,
}: {
  peers: readonly ChannelPeerSession[];
  byUser: ReadonlyMap<string, ChannelMember>;
}) {
  if (peers.length === 0) return null;
  return (
    <>
      {peers.map((peer) => {
        const owner = byUser.get(peer.userId) ?? null;
        const ownerName = owner?.displayName || "A teammate";
        const stale = peerRowStale(peer);
        return (
          <div
            key={`${peer.userId}:${peer.name}:${peer.threadId ?? ""}`}
            data-stale={stale ? "true" : undefined}
            className={cn(PANEL_CARD, stale && "opacity-60")}
          >
            <div className="flex items-center gap-2">
              {owner ? (
                <Avatar person={memberPerson(owner)} size="xs" />
              ) : (
                <Bot size={14} aria-hidden className="shrink-0 text-text-secondary" />
              )}
              {/* ⚠ **BEFORE THE NAME, AND OFF THE PROJECTION THIS CARD ALREADY HAS**
                  (Samuel, 2026-09-13; docs/specs/agent-colors.md item 8). `peer.color` rides
                  `ChannelSessionState` — peer-visible by design, which is the entire ruling:
                  *"this will be categorized not only for the own users' agents, but also for
                  other users' agents."* No new read, and no colour is derived here.
                  ⚠ NO GATE ON LIVENESS: an ended peer row never reaches the wire at all
                  (`main/session-state-push.js › liveForWire`), so every row on this card is
                  live by construction and a `state` test would be dead code. */}
              <AgentColorDot color={agentColorOrNull(peer.color)} />
              <span className="min-w-0 flex-1 truncate text-body font-semibold text-text-primary">
                {/* ⚠ THE PEER'S OWN NAME FOR IT, when their desktop reported one
                    (2026-08-31, `channel_sessions.display_name` — Samuel's ruling:
                    you should see a teammate is running a "Bug Reviewer").
                    Falls back to the id handle exactly as before. */}
                {peer.displayName?.trim() || peer.name}
              </span>
              {/* ⚠ A PEER ROW HAS NO `detail` AND NO `listening` — the
                  cross-machine wire carries the coarse state alone (INVARIANTS
                  §11) — so the SAME mapping degrades it to Running / Idle. */}
              <AgentLiveness {...agentLiveness(peer)} />
            </div>
            <div className="flex min-w-0 items-center gap-1.5 text-caption text-text-secondary">
              <CornerDownRight size={12} aria-hidden className="shrink-0 text-text-muted" />
              <span className="min-w-0 truncate">
                {ownerName}&apos;s agent
                {peer.threadTitle ? ` · ${peer.threadTitle}` : ""}
                {/* ⚠ NO TIMESTAMP ON A PEER CARD (Samuel, 2026-09-04): *"the
                    profile image of the user they belong to, plus status only —
                    thinking / working / idle / ended. No timestamp, no other
                    metadata."* THE DIMMING STAYS AND SO DOES `peerRowStale` — the
                    ruling is about what the card SAYS, not what it knows. Do not
                    re-derive a clause from `updatedAt` here. */}
              </span>
            </div>
          </div>
        );
      })}
    </>
  );
}

/**
 * One agent rectangle, on the shared `bits.tsx › PANEL_CARD` face (see the file
 * docblock, which also states the every-absence rule this card follows).
 *
 * The meter is the shared `UsageMeter` at `tone="ramp"`: a context window is
 * GLANCED at, not read. `over` is not passed — it is an entitlement verdict the
 * caller owns, and a full context window is not an entitlement event.
 */
export function AgentCard({
  agent,
  owner = null,
  viewing,
  color = null,
  onOpen,
}: {
  agent: DesktopSessionSummary;
  /**
   * **THIS AGENT'S COLOUR, SUPPLIED BY THE HOST** (2026-09-13; docs/specs/agent-colors.md
   * item 8).
   *
   * ⚠ **IT IS A PROP AND NOT A FIELD ON {@link agent}, WHICH IS THE OPPOSITE OF HOW
   * `templateName` AND `diag` ABOVE WORK, AND THE REASON IS WORTH KEEPING STRAIGHT.** Those
   * two are OWN-ONLY because the local feed is the only thing that knows them. A colour is
   * the other way round: it is the SERVER's assignment against every member's live agents
   * (`20261005120000`'s per-channel unique index), so `DesktopSessionSummary` — this
   * machine's own feed — is the one source that CANNOT know it. The host reads it off the
   * peer ∪ own union (`channel-surface-data.ts › liveAgents`).
   *
   * ⚠ `null` DRAWS NOTHING, never a placeholder — `agent-color-dot.tsx` argues why an
   * ended agent gets no grey mark on a list like this one.
   */
  color?: AgentColorKey | null;
  /** The card's owner (me) — every card wears its member's avatar (2026-08-20). */
  owner?: ChannelMember | null;
  viewing: boolean;
  onOpen: () => void;
}) {
  // ⚠ THE PLACE, NOT A MISSING FIELD (Samuel, 2026-08-27) — `agents-model.ts › NO_THREAD_LABEL`.
  // This card read "No thread title" until 2026-08-28, describing an absent column, while the
  // panel that opens FROM it already said "in main channel": one agent, two answers, in two
  // surfaces the operator moves between with a click. A channel-level agent is on the ROOM on
  // purpose (`agents-controls.ts`: `taskId: null`), which is a place and has a name.
  const threadTitle = agent.threadTitle ?? NO_THREAD_LABEL;
  const contextUsed = metric(agent.contextUsed);
  const contextWindow = metric(agent.contextWindow);
  const tokensSpent = metric(agent.tokensSpent);
  const ended = agent.state === "ended";
  const description = agentDescription(agent);
  // ⚠ THE SESSION'S model, never the CHANNEL's stored pick — a live agent may
  // have been switched mid-run, or spawned before the posture changed.
  const modelLabel = agentModelShortLabel(agentRunningModel(agent));
  // ⚠ WHICH IDENTITY THIS AGENT IS WEARING (2026-08-22, agent templates) — a
  // SNAPSHOT of the name main resolved at spawn, never a pointer, so the session
  // keeps what it RAN AS after the template is renamed or deleted
  // (`spa-bridge-shapes.ts › DesktopSessionSummary.templateName`). Absent and
  // `null` both render nothing (INVARIANTS §11 — UNKNOWN is not EMPTY).
  // ⚠ OPERATOR-ONLY, AND STRUCTURALLY SO: `channel_sessions.template_name` is
  // excluded from the peer projection, because a private template's name on a
  // colleague's card is an existence oracle. Do not plumb it into `PeerCards`.
  const templateName = agent.templateName?.trim() || null;
  // ⚠ NO TIMING LINE AND NO "N of yours here" SINCE 2026-09-08 (Samuel: remove
  // both); the ended PILL states the one fact that matters.

  return (
    // `group/card` is the pencil's hover scope — see `AgentName`.
    <div className={cn(PANEL_CARD, "group/card", viewing && "border-border-highlight")}>
      <div className="flex items-center gap-2">
        {owner ? (
          <Avatar person={memberPerson(owner)} size="xs" />
        ) : (
          <Bot size={14} aria-hidden className="shrink-0 text-text-secondary" />
        )}
        {/* ⚠ BEFORE THE NAME, exactly as on the peer cards above — the mark has to sit in
            the same place on both shapes or it stops being one mark. ⚠ AND IT IS NOT GATED
            ON `ended` HERE EITHER, for a different reason than the peer block's: an ENDED
            agent's key is already back in the bank, so the host resolves `null` for it
            (`view-model.ts › indexAgents` forces it) and the dot is absent WITHOUT this file
            re-deciding the bank rule. */}
        <AgentColorDot color={color} />
        {/* ⚠ THE OWN card renames; the PEER cards above do not and must not. A colleague's
            agent is named on THEIR machine, and this write reaches only this one. */}
        <AgentName agentId={agent.agentId} name={agentDisplayName(agent)} />
        {/* ⚠ THE PILL REPLACES THE LIVENESS ON AN ENDED CARD (2026-08-22) rather
            than joining it. MY OWN cards get the finer sentence; the peer cards
            above do not — the cross-machine wire carries the coarse state alone. */}
        {ended ? <AgentEndedPill /> : <AgentLiveness {...agentLiveness(agent)} />}
      </div>

      {/* ⚠ WHY THIS AGENT CANNOT WORK — rendered only when main says so
          (2026-09-13, F-692; `spa-bridge-shapes.ts › DesktopSessionSummary.diag`).
          The pill cannot carry it: `state` is the server's three-value vocabulary,
          so an agent whose Dopl MCP server never connected read `working` for its
          whole run and then `Ended`, with the reason nowhere on this surface.
          ⚠ `text-danger`, because this is the one line on the card that is a
          FAILURE rather than a measurement — and it is one line, not a paragraph
          (minimal copy, INVARIANTS §5); `title` carries the whole sentence.
          ⚠ OWN CARDS ONLY, like `templateName` above: the field is local-only by
          construction and never reaches a peer's projection. */}
      {agent.diag && (
        <p
          className="min-w-0 truncate text-caption text-danger"
          title={agent.diag}
        >
          {agent.diag}
        </p>
      )}

      {/* ⚠ WHAT IT IS FOR, under what it is CALLED — one line, truncated, no label and no pill
          (minimal copy, INVARIANTS §5; a 380px card cannot afford chrome for this). `title`
          carries the whole thing for a description that does not fit. */}
      {description && (
        <p className="min-w-0 truncate text-caption text-text-secondary" title={description}>
          {description}
        </p>
      )}

      <div className="flex min-w-0 items-center gap-1.5 text-caption text-text-secondary">
        <CornerDownRight size={12} aria-hidden className="shrink-0 text-text-muted" />
        <span className="min-w-0 truncate">{threadTitle}</span>
        {/* ⚠ THE TEMPLATE READS BEFORE THE MODEL — it is WHO this agent is, the
              model only what it runs on. Both ride this detail line rather than
              earning chrome (minimal copy, INVARIANTS §5), and both render NOTHING
              when unreported: "Default" would be this build claiming to know
              (`agents-model.ts › agentRunningModel`). */}
        {templateName && (
          <span className="min-w-0 truncate text-text-muted">· {templateName}</span>
        )}
        {modelLabel && (
          <span className="shrink-0 text-text-muted">· {modelLabel}</span>
        )}
      </div>

      {contextUsed !== null && contextWindow !== null && (
        <UsageMeter
          label="Context tokens"
          used={contextUsed}
          limit={contextWindow}
          tone="ramp"
          formatValue={formatTokens}
          className="mt-0.5"
        />
      )}

      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-caption text-text-muted">
          {tokensSpent === null
            ? "Tokens spent: not measured yet"
            : `Tokens spent: ${formatTokens(tokensSpent)}`}
        </span>
        {/* ⚠ DELETE SITS LEFT OF OPEN, ON EVERY OWN CARD — running, idle and
            retained-ended alike (Samuel, 2026-08-25). A NAKED GLYPH revealed by
            this card's hover (`agent-delete.tsx`), never a second button face: a
            permanent trash beside every agent is a destructive control the eye has
            to keep declining. ⚠ THE PEER CARDS ABOVE HAVE NONE AND MUST NOT — this
            op reaches only local stores, so there it would control nothing. */}
        <AgentDeleteButton agent={agent} />
        <button
          type="button"
          onClick={onOpen}
          aria-current={viewing ? "true" : undefined}
          className={CARD_BUTTON}
        >
          {viewing ? "Viewing" : "Open"}
        </button>
      </div>
    </div>
  );
}
