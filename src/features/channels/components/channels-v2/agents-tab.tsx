"use client";

/**
 * Channels v2 — the right panel's AGENTS tab: MY agents running in this
 * channel, one card each, each with a way into the agent view.
 *
 * ⚠ WIRED (wiring plan Phase 5, 2026-08-18). `fixtures-agents.ts` is DELETED.
 * Every card is one live entry from this machine's own session projection —
 * `agents-model.ts`, over `spa-bridge.ts › DesktopSessionSummary` — including
 * the context and token numbers, which the desktop measures and the server
 * stores none of (INVARIANTS §5's Agents-tab bullet; the ruling arrived in the
 * port's intent doc, deleted at the Phase 12 cutover).
 *
 * It is an OPERATOR surface, not a roster, and that is structural: the feed IS
 * one machine's own registry, so another member's agent cannot appear here.
 * The Info tab's Members list is where everyone's presence lives.
 *
 * ⚠ DESKTOP-ONLY, AND IT SAYS SO RATHER THAN SHOWING NOTHING. In a plain
 * browser (or on a desktop older than the feed) there is no local runtime to
 * read, so the tab states that reality — "could not ask" and "asked, nothing is
 * running" are different facts and are worded differently. An empty list under
 * a browser would read as "you have no agents", which is a claim this surface
 * cannot make.
 *
 * An operator can be running several agents at once, and more than one of them
 * on the SAME thread — the cards are grouped so that reads off the column
 * instead of having to be inferred.
 *
 * ⚠ COPY RULE (INVARIANTS §5): inside one member's window there is exactly ONE
 * session, so it never needs a qualifier. Nothing here writes "agent session"
 * or "channel session" — the noun on this surface is the AGENT.
 */

import { Bot, CornerDownRight, Plus } from "lucide-react";
import { Avatar } from "@/shared/ui/avatar";
import { UsageMeter } from "@/shared/ui/usage-meter";
import { formatRelativeTime } from "@/shared/lib/format-time";
import { cn } from "@/shared/lib/utils";
import type { DesktopSessionSummary } from "@/shared/lib/spa-bridge";
import type { ChannelPeerSession } from "../../hooks/use-channel-agent-sessions";
import type { ChannelMember } from "../../types";
import { memberPerson } from "./view-model";
import { AgentLiveness, CARD_BUTTON, PANEL_CARD } from "./bits";
import {
  agentDetailLabel,
  agentKey,
  agentsPerThread,
  formatTokens,
  metric,
  ownAgentsFor,
  peerCardsFor,
} from "./agents-model";

/** Absolute epoch ms → the relative phrase the cards use. `formatRelativeTime`
 *  takes an ISO string and answers "" for an absent one, which is the right
 *  degradation: the caller drops the whole clause rather than printing a stub. */
function relative(at: number | null): string {
  return at === null ? "" : formatRelativeTime(new Date(at).toISOString());
}

export function AgentsTab({
  sessions,
  channelId,
  openThreadId = null,
  members = [],
  currentUserId = null,
  peers = [],
  canLaunch = false,
  launchBusy = false,
  onLaunchAgent,
  openAgent,
  onOpenAgent,
}: {
  /** The whole machine's feed, or `null` for "could not ask" — no bridge, or a
   *  main without it. ⚠ Never collapse `null` into `[]` on the way in. */
  sessions: readonly DesktopSessionSummary[] | null;
  channelId: string;
  /** The OPEN thread (2026-08-20): scopes the tab — thread view shows that
   *  thread's agents alone; channel view shows the whole channel's. */
  openThreadId?: string | null;
  /** The roster, for the owner avatar every card wears. */
  members?: ChannelMember[];
  currentUserId?: string | null;
  /** EVERY member's session STATE for this channel (the server projection) —
   *  peers render as state-only cards, never openable. */
  peers?: readonly ChannelPeerSession[];
  /** The launch button (thread view only; desktop only). */
  canLaunch?: boolean;
  launchBusy?: boolean;
  onLaunchAgent?: (threadId: string) => void;
  /** `agentKey(session)` of the open agent view, or null. */
  openAgent: string | null;
  onOpenAgent: (key: string) => void;
}) {
  const byUser = new Map(members.map((m) => [m.userId, m]));
  const me = currentUserId ? (byUser.get(currentUserId) ?? null) : null;
  // Peers: other members' live rows, thread-scoped like everything on the tab.
  // Own rows are excluded — the LOCAL feed below is the richer truth for mine.
  // ⚠ THE PREDICATE IS `agents-model.ts › peerCardsFor`, NOT AN INLINE FILTER
  // (2026-08-20): the tab-row badge counts the same rows this list draws, and a
  // second copy of the rule is how a badge comes to say 3 over a list of 2.
  const peerCards = peerCardsFor(peers, currentUserId, openThreadId);

  const launchRow = canLaunch && openThreadId && onLaunchAgent && (
    <button
      type="button"
      disabled={launchBusy}
      onClick={() => onLaunchAgent(openThreadId)}
      className="mb-3 flex w-full items-center justify-center gap-1.5 rounded-[10px] border border-dashed border-border-strong px-3 py-2 text-caption font-medium text-text-primary transition-colors hover:bg-card-surface-subtle disabled:opacity-60"
    >
      <Plus size={13} aria-hidden />
      {launchBusy ? "Launching…" : "Launch agent"}
    </button>
  );

  if (sessions === null) {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto px-3.5 pb-6 pt-4">
        {peerCards.length > 0 && <PeerCards peers={peerCards} byUser={byUser} />}
        <p className="px-0.5 py-6 text-center text-caption text-text-muted">
          Your agents run on your own machine, so this list needs the Dopl
          desktop app. Nothing about them is stored on the server.
        </p>
      </div>
    );
  }

  // ⚠ Same one-derivation rule as `peerCards` above — `ownAgentsFor` is what the
  // tab row's badge counts, so the list and the number are one function.
  const mine = ownAgentsFor(sessions, channelId, openThreadId);
  const perThread = agentsPerThread(mine);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-3.5 pb-6 pt-4">
      {launchRow}
      <p className="pb-3 text-caption text-text-muted">
        {openThreadId
          ? "Agents on this thread. Yours first."
          : "Agents in this channel. Yours first."}
      </p>
      {mine.length === 0 && peerCards.length === 0 ? (
        <p className="py-6 text-center text-caption text-text-muted">
          {openThreadId
            ? "No agents on this thread yet."
            : "No agents running in this channel."}
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {mine.map((agent) => (
            <AgentCard
              key={agentKey(agent)}
              agent={agent}
              owner={me}
              siblings={(perThread.get(agent.taskId) ?? 1) - 1}
              viewing={agentKey(agent) === openAgent}
              onOpen={() => onOpenAgent(agentKey(agent))}
            />
          ))}
          <PeerCards peers={peerCards} byUser={byUser} />
        </div>
      )}
    </div>
  );
}

/**
 * Other members' agents — STATE ONLY, never openable (Samuel, 2026-08-20): the
 * card exists so the operator can see who else has an agent on the exchange
 * and whether it is working; nothing private is reachable from it.
 */
function PeerCards({
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
        return (
          <div key={`${peer.userId}:${peer.name}:${peer.threadId ?? ""}`} className={PANEL_CARD}>
            <div className="flex items-center gap-2">
              {owner ? (
                <Avatar person={memberPerson(owner)} size="xs" />
              ) : (
                <Bot size={14} aria-hidden className="shrink-0 text-text-secondary" />
              )}
              <span className="min-w-0 flex-1 truncate text-body font-semibold text-text-primary">
                {peer.name}
              </span>
              <AgentLiveness running={peer.state === "working"} />
            </div>
            <div className="flex min-w-0 items-center gap-1.5 text-caption text-text-secondary">
              <CornerDownRight size={12} aria-hidden className="shrink-0 text-text-muted" />
              <span className="min-w-0 truncate">
                {ownerName}&apos;s agent
                {peer.threadTitle ? ` · ${peer.threadTitle}` : ""}
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
function AgentCard({
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
  const timing = [
    started && `Started ${started}`,
    lastActivity && `Last activity ${lastActivity}`,
  ].filter(Boolean);

  return (
    <div className={cn(PANEL_CARD, viewing && "border-border-highlight")}>
      <div className="flex items-center gap-2">
        {owner ? (
          <Avatar person={memberPerson(owner)} size="xs" />
        ) : (
          <Bot size={14} aria-hidden className="shrink-0 text-text-secondary" />
        )}
        <span className="min-w-0 flex-1 truncate text-body font-semibold text-text-primary">
          {agent.name}
        </span>
        {/* ⚠ MY OWN cards get the finer sentence; the peer cards above do not,
            because the cross-machine wire carries the coarse state alone. */}
        <AgentLiveness
          running={agent.state === "working"}
          detail={agentDetailLabel(agent)}
        />
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
