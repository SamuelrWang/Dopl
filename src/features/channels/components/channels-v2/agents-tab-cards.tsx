"use client";

/**
 * THE TWO CARD SHAPES THE AGENTS TAB DRAWS — my own agent, and a peer's — split
 * out of `agents-tab.tsx` on 2026-08-22 at the 500-line cap, when the template
 * picker landed on that file's New Agent button.
 *
 * ⚠ THE SEAM IS §1's "one file, one reason to change", not the line count that
 * forced the question. `agents-tab.tsx` is now a LIST plus a LAUNCH control, and
 * it moves when the launch surface moves (it has moved three times in two days:
 * the button, the multiplayer re-scope, the split button). A CARD moves when the
 * session feed's shape moves. Two rates of change in one file is how a card gets
 * re-reviewed every time a glyph is added to a button.
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
import { AgentName } from "./agent-rename";
import { AgentDeleteButton } from "./agent-delete";
import { Avatar } from "@/shared/ui/avatar";
import { UsageMeter } from "@/shared/ui/usage-meter";
import { formatRelativeTime } from "@/shared/lib/format-time";
import { cn } from "@/shared/lib/utils";
import type { DesktopSessionSummary } from "@/shared/lib/spa-bridge";
import type { ChannelPeerSession } from "../../hooks/use-channel-agent-sessions";
import type { ChannelMember } from "../../types";
import { memberPerson } from "./view-model";
import { CARD_BUTTON, PANEL_CARD } from "./bits";
import { AgentEndedPill, AgentLiveness } from "./agent-bits";
import {
  agentDisplayName,
  agentEndedAt,
  agentLiveness,
  agentRunningModel,
  peerRowStale,
} from "./agents-model";
import { formatTokens, metric } from "./agent-metrics";
import { agentModelShortLabel } from "../../lib/agent-models";

/** Absolute epoch ms → the relative phrase the cards use. `formatRelativeTime`
 *  takes an ISO string and answers "" for an absent one, which is the right
 *  degradation: the caller drops the whole clause rather than printing a stub. */
function relative(at: number | null): string {
  return at === null ? "" : formatRelativeTime(new Date(at).toISOString());
}

/**
 * Other members' agents — STATE ONLY, never openable (Samuel, 2026-08-20): the
 * card exists so the operator can see who else has an agent on the exchange
 * and whether it is working; nothing private is reachable from it.
 *
 * ⚠ A QUIET ROW IS DIMMED, NEVER DROPPED (Samuel, 2026-08-22): *"the card STAYS
 * until the session actually goes away."* The row's PRESENCE is the liveness
 * signal — the desktop's push replaces its whole set, so an ended session leaves
 * by omission (`agents-model.ts › peerCardsFor`). What `agents-model.ts ›
 * peerRowStale` still answers is that the row has not MOVED lately, which is a
 * weaker claim than "gone" and gets a weaker treatment: `opacity-60`, the same
 * shade the kit's optimistic `PENDING_ROW` wears, plus the honest
 * `data-stale` hook the test reads. ⚠ **It is not a heartbeat** — `updated_at`
 * moves on a state CHANGE — so a perfectly live idle agent dims after 90 s, and
 * the ONE clause below is what keeps that legible instead of mysterious.
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
              <span className="min-w-0 flex-1 truncate text-body font-semibold text-text-primary">
                {peer.name}
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
                {/* ⚠ THE ONE CLAUSE A DIMMED CARD EARNS, and it is a FACT rather
                    than an explanation: when this row last moved. No "may be
                    offline" copy — the surface does not know that, and a guess
                    is what the deleted freshness guard was (INVARIANTS §5,
                    minimal copy). Absent stamp → `formatRelativeTime` answers
                    "" and the clause is simply not there. */}
                {stale && peer.updatedAt
                  ? ` · last update ${formatRelativeTime(peer.updatedAt)}`
                  : ""}
              </span>
            </div>
          </div>
        );
      })}
    </>
  );
}

/**
 * One agent rectangle, on the same `.bento` card face as a thread card
 * (`bits.tsx › PANEL_CARD`) — the two tabs are one column and a second card
 * shape would read as a second surface.
 *
 * The meter is the shared `UsageMeter` at `tone="ramp"`: a context window is
 * GLANCED at, not read. `over` is not passed — it is an entitlement verdict the
 * caller owns, and a full context window is not an entitlement event.
 *
 * ⚠ EVERY NUMBER IS OPTIONAL AND EVERY ABSENCE IS RENDERED AS ONE. No meter
 * without a denominator, no "Started" without a stamp, no `0` standing in for
 * "not measured yet" (INVARIANTS §11).
 */
export function AgentCard({
  agent,
  owner = null,
  siblings,
  viewing,
  onOpen,
}: {
  agent: DesktopSessionSummary;
  /** The card's owner (me) — every card wears its member's avatar (2026-08-20). */
  owner?: ChannelMember | null;
  siblings: number;
  viewing: boolean;
  onOpen: () => void;
}) {
  // A session with no first-class thread is a real session; it just has no title
  // to show, and saying so beats an empty line.
  const threadTitle = agent.threadTitle ?? "No thread title";
  const contextUsed = metric(agent.contextUsed);
  const contextWindow = metric(agent.contextWindow);
  const tokensSpent = metric(agent.tokensSpent);
  const started = relative(metric(agent.startedAt));
  const lastActivity = relative(metric(agent.lastActivityAt));
  const ended = agent.state === "ended";
  // ⚠ WHEN IT ENDED, IN THE LINE THAT ALREADY EXISTS (2026-08-22) — no new
  // element, and it is the one thing about an ended agent an operator actually
  // sorts by ("which of these finished last"). ⚠ ABSENT ON AN OLDER MAIN and on
  // an agent that ended before the field shipped, which renders as the clause
  // simply not being there; the PILL is what states the fact, never this.
  // ⚠ NO RETENTION COUNTDOWN. The history is swept on main's own schedule and
  // there is nothing the operator can do about it, so a clock here would be
  // anxiety with no action attached.
  const endedAt = relative(agentEndedAt(agent));
  // ⚠ THE SESSION'S model, never the CHANNEL's stored pick — a live agent may
  // have been switched mid-run, or spawned before the posture changed.
  const modelLabel = agentModelShortLabel(agentRunningModel(agent));
  // ⚠ WHICH IDENTITY THIS AGENT IS WEARING (2026-08-22, agent templates). A
  // SNAPSHOT of the name main resolved at spawn, never a pointer — the session
  // keeps what it RAN AS after that template is renamed or deleted
  // (`spa-bridge-shapes.ts › DesktopSessionSummary.templateName`).
  // ⚠ ABSENT AND `null` ARE THE SAME ANSWER and both render nothing: a blank
  // agent has no template, and an older main omits the field. Neither is a
  // reason to print a word (INVARIANTS §11 — UNKNOWN is not EMPTY).
  // ⚠ OPERATOR-ONLY, AND STRUCTURALLY SO. This is the OWN-agent card, fed by
  // this machine's local registry; the peer cards above read `ChannelPeerSession`,
  // which has no such field because `channel_sessions.template_name` is excluded
  // from the peer projection — a private template's name on a colleague's card is
  // an existence oracle. Do not plumb it into `PeerCards`.
  const templateName = agent.templateName?.trim() || null;
  const timing = [
    started && `Started ${started}`,
    ended ? endedAt && `Ended ${endedAt}` : lastActivity && `Last activity ${lastActivity}`,
  ].filter(Boolean);

  return (
    // `group/card` is the pencil's hover scope — see `AgentName`.
    <div className={cn(PANEL_CARD, "group/card", viewing && "border-border-highlight")}>
      <div className="flex items-center gap-2">
        {owner ? (
          <Avatar person={memberPerson(owner)} size="xs" />
        ) : (
          <Bot size={14} aria-hidden className="shrink-0 text-text-secondary" />
        )}
        {/* ⚠ THE OWN card renames; the PEER cards above do not and must not. A colleague's
            agent is named on THEIR machine, and this write reaches only this one. */}
        <AgentName agentId={agent.agentId} name={agentDisplayName(agent)} />
        {/* ⚠ THE PILL REPLACES THE LIVENESS ON AN ENDED CARD (2026-08-22), it
            does not join it: "Ended" beside a dot reading "Ended" is one fact
            said twice. ⚠ MY OWN cards get the finer sentence; the peer cards
            above do not, because the cross-machine wire carries the coarse
            state alone. */}
        {ended ? <AgentEndedPill /> : <AgentLiveness {...agentLiveness(agent)} />}
      </div>

      <div className="flex min-w-0 items-center gap-1.5 text-caption text-text-secondary">
        <CornerDownRight size={12} aria-hidden className="shrink-0 text-text-muted" />
        <span className="min-w-0 truncate">{threadTitle}</span>
        {siblings > 0 && (
          // Says the shared-thread case out loud. The grouping already puts the
          // two cards together; this is what tells you the adjacency is the
          // point rather than a coincidence of ordering.
          <span className="shrink-0 text-text-muted">
            · {siblings + 1} of yours here
          </span>
        )}
        {/* ⚠ THE EFFECTIVE MODEL, and ONLY when this build reports one
              (2026-08-22). It rides the existing detail line rather than earning
              chrome of its own — minimal copy (INVARIANTS §5), and a fourth pill
              on a 380px card is clutter. Absent renders NOTHING: a main that does
              not report a model has said nothing about what this agent is running,
              and "Default" would be this build claiming to know
              (`agents-model.ts › agentRunningModel`). */}
        {/* ⚠ THE TEMPLATE READS BEFORE THE MODEL, because it is WHO this agent
              is and the model is only what it runs on. Same detail line, same
              minimal-copy rule — no pill, no "Template:" label. */}
        {templateName && (
          <span className="min-w-0 truncate text-text-muted">· {templateName}</span>
        )}
        {modelLabel && (
          <span className="shrink-0 text-text-muted">· {modelLabel}</span>
        )}
      </div>

      {timing.length > 0 && (
        <span className="text-caption text-text-muted">{timing.join(" · ")}</span>
      )}

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
            retained-ended alike (Samuel, 2026-08-25). A card the operator can
            see is a card they can be rid of, and an ended agent is exactly the
            one they most often want gone. It is a NAKED GLYPH revealed by this
            card's hover (`agent-delete.tsx`), not a second button face: a
            permanent trash beside every agent is a destructive control the eye
            has to keep declining.
            ⚠ THE PEER CARDS ABOVE HAVE NONE AND MUST NOT. A colleague's agent
            runs on THEIR machine; this op reaches only local stores, so a trash
            icon there would be a control over nothing. */}
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
