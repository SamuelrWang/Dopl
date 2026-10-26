"use client";

/**
 * Channels — THE AGENT'S NUMBERS, one component for every surface that shows them (the agent view,
 * the agent window, the Agents tab card, the landing demo): the context readout over a thin meter
 * in the agent's colour, and the muted meta line, in the card well.
 *
 * ⚠ Absences render AS absences: no denominator, no stamp, no clause. Never a zero standing in for
 * "not measured" — a reported `contextUsed` with no `contextWindow` prints the number alone, never
 * `84k / 0k`, and the bar sits empty at zero.
 */

import type { DesktopSessionSummary } from "@/shared/lib/spa-bridge";
import { ThinMeter } from "@/shared/ui/usage-meter";
import { formatRelativeTime } from "@/shared/lib/format-time";
import { formatTokens } from "@/shared/lib/format-tokens";
import { agentColorVar } from "@/shared/lib/agent-colors";
import type { AgentColorKey } from "../types";
import { metric } from "./agent-metrics";

/** "Context tokens" with its readout over the meter, which warns as the window fills. */
export function ContextMeter({
  agent,
  color = null,
  className,
}: {
  agent: DesktopSessionSummary;
  /** The agent's colour key, resolved by the host; `null` draws the meter in ink. */
  color?: AgentColorKey | null;
  className?: string;
}) {
  const used = metric(agent.contextUsed) ?? 0;
  const window = metric(agent.contextWindow) ?? 0;
  return (
    <div className={className}>
      <p className="mb-1.5 flex items-center justify-between gap-2 text-label text-text-muted">
        Context tokens
        <span className="whitespace-nowrap text-caption font-medium tabular-nums text-text-primary">
          {window > 0 ? `${formatTokens(used)} / ${formatTokens(window)}` : formatTokens(used)}
        </span>
      </p>
      <ThinMeter
        used={used}
        limit={window}
        color={color ? agentColorVar(color) : null}
        warnNearFull
      />
    </div>
  );
}

export function AgentStats({
  agent,
  color = null,
  showStarted = true,
}: {
  agent: DesktopSessionSummary;
  color?: AgentColorKey | null;
  /** ⚠ OFF IN THE WINDOW, which is 510px wide — a third clause wraps the line there. */
  showStarted?: boolean;
}) {
  const spent = metric(agent.tokensSpent);
  const startedAt = metric(agent.startedAt);
  const lastAt = metric(agent.lastActivityAt);
  const line = [
    showStarted &&
      startedAt !== null &&
      `Started ${formatRelativeTime(new Date(startedAt).toISOString())}`,
    spent !== null && `${formatTokens(spent)} tokens spent`,
    lastAt !== null &&
      `Last activity ${formatRelativeTime(new Date(lastAt).toISOString())}`,
  ].filter(Boolean);

  return (
    <div className="card-well px-2.75 pt-2.25 pb-2.5">
      <ContextMeter agent={agent} color={color} />
      {line.length > 0 && (
        <p className="mt-2 text-label text-text-muted">{line.join(" · ")}</p>
      )}
    </div>
  );
}
