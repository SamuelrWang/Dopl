/**
 * Channels v2 — the right panel's AGENTS tab: MY agents running in this
 * channel, one card each, each with a way into the agent view.
 *
 * It is an OPERATOR surface, not a roster — the Info tab's Members list is
 * where everyone's presence lives. Nothing here is another member's runtime:
 * their agents are visible as message authors and addressee pills, and their
 * context and spend are theirs to watch (MAPPING.md § Agents tab & the agent
 * view).
 *
 * An operator can be running several agents at once, and more than one of them
 * on the SAME thread — the cards are grouped so that reads off the column
 * instead of having to be inferred.
 */

import { Bot, CornerDownRight } from "lucide-react";
import { UsageMeter } from "@/shared/ui/usage-meter";
import { cn } from "@/shared/lib/utils";
import { AgentLiveness, CARD_BUTTON, PANEL_CARD } from "./bits";
import {
  AGENTS_PER_THREAD,
  GROUPED_AGENTS,
  formatTokens,
  type MockAgent,
} from "./mock-agents";
import { THREADS } from "./mock-threads";

/** Thread title, read live off the thread fixture — an agent card that named a
 *  thread the tree no longer has would be a fixture that disagrees with itself. */
export function threadTitle(threadId: string): string {
  return THREADS.find((t) => t.id === threadId)?.title ?? "Unknown thread";
}

export function AgentsTab({
  openAgent,
  onOpenAgent,
}: {
  openAgent: string | null;
  onOpenAgent: (id: string) => void;
}) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-3.5 pb-6 pt-4">
      <p className="pb-3 text-caption text-text-muted">
        Your agents working in this channel. Other members&apos; agents run in
        their own window.
      </p>
      <div className="flex flex-col gap-2">
        {GROUPED_AGENTS.map((agent) => (
          <AgentCard
            key={agent.id}
            agent={agent}
            viewing={agent.id === openAgent}
            onOpen={() => onOpenAgent(agent.id)}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * One agent rectangle, on the same `.bento` card face as a thread card
 * (`bits.tsx › PANEL_CARD`) — the two tabs are one column and a second card
 * shape would read as a second surface.
 *
 * The meter is the shared `UsageMeter` at `tone="ramp"`: a context window is
 * GLANCED at, not read, and the ramp is exactly the variant written for that
 * (docs/DESIGN-SYSTEM.md). `over` is not passed — it is an entitlement verdict
 * the caller owns, and a full context window is not an entitlement event.
 */
function AgentCard({
  agent,
  viewing,
  onOpen,
}: {
  agent: MockAgent;
  viewing: boolean;
  onOpen: () => void;
}) {
  const { label, threadId, state, startedAt, lastActivityAt } = agent;
  const siblings = (AGENTS_PER_THREAD[threadId] ?? 1) - 1;

  return (
    <div className={cn(PANEL_CARD, viewing && "border-border-highlight")}>
      <div className="flex items-center gap-2">
        <Bot size={14} aria-hidden className="shrink-0 text-text-secondary" />
        <span className="min-w-0 flex-1 truncate text-body font-semibold text-text-primary">
          {label}
        </span>
        <AgentLiveness running={state === "running"} />
      </div>

      <div className="flex min-w-0 items-center gap-1.5 text-caption text-text-secondary">
        <CornerDownRight size={12} aria-hidden className="shrink-0 text-text-muted" />
        <span className="min-w-0 truncate">{threadTitle(threadId)}</span>
        {siblings > 0 && (
          // Says the shared-thread case out loud. The grouping already puts the
          // two cards together; this is what tells you the adjacency is the
          // point rather than a coincidence of ordering.
          <span className="shrink-0 text-text-muted">
            · {siblings + 1} of yours here
          </span>
        )}
      </div>

      <span className="text-caption text-text-muted">
        Started {startedAt} · Last activity {lastActivityAt}
      </span>

      <UsageMeter
        label="Context tokens"
        used={agent.contextUsed}
        limit={agent.contextWindow}
        tone="ramp"
        formatValue={formatTokens}
        className="mt-0.5"
      />

      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-caption text-text-muted">
          Tokens spent: {agent.tokensSpent}
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
