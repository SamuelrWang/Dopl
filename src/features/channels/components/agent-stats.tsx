"use client";

/**
 * Channels — THE AGENT'S NUMBERS, one component for every surface that shows them.
 *
 * ⚠ **IT IS ITS OWN FILE SINCE 2026-09-17 (P17).** It was declared in `agent-panel.tsx` and
 * TRANSCRIBED a second time in `agent-window.tsx` (`AgentWindowStats`), and the two copies had
 * already drifted twice — each carrying its own stale paragraph about a meter arm that had been
 * retired. The panel stood at the §1 cap, so the collapse is a SPLIT rather than a prop added in
 * place: three hosts (the panel, the window, the landing page's hero demo) now import one
 * declaration.
 */

import type { DesktopSessionSummary } from "@/shared/lib/spa-bridge";
import { UsageMeter } from "@/shared/ui/usage-meter";
import { formatRelativeTime } from "@/shared/lib/format-time";
import { formatTokens, metric } from "./agent-metrics";

/**
 * The compact restatement of the card's numbers — **ONE implementation for ALL THREE HOSTS**
 * (P17, collapsed 2026-09-17): this panel, the agent WINDOW, and the marketing demo. The window
 * carried a second copy, `AgentWindowStats`, whose docblock had already drifted apart from this
 * one twice.
 *
 * ⚠ Absences render AS absences: no denominator, no stamp, no clause. Never a zero standing in
 * for "not measured". The DENOMINATOR half is `shared/ui/usage-meter.tsx`'s — a reported
 * `contextUsed` with no `contextWindow` prints the number alone, never `84k / 0k`.
 */
export function AgentStats({
  agent,
  meterClassName,
  showStarted = true,
}: {
  agent: DesktopSessionSummary;
  /** 🔒 `""` IN THE WINDOW (Samuel, 2026-09-15): the meter's own `mt-3` default stacked on
   *  `agent-posture.tsx`'s margin and made the 20px gap he asked closed. Omitted keeps `mt-3`. */
  meterClassName?: string;
  /** ⚠ OFF IN THE WINDOW, which is 510px wide — a third clause wraps the line there. */
  showStarted?: boolean;
}) {
  const used = metric(agent.contextUsed);
  const window = metric(agent.contextWindow);
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
    <div className="flex flex-col gap-1.5">
      {/* ⚠ THE BAR AT ZERO, ALWAYS — there is no "not measured" line any more (Samuel,
          2026-08-27). A spawn-idle agent has reported no `contextWindow`, and a fresh agent's
          usage is a MEASURED zero. `UsageMeter` owns the no-denominator case itself (empty track,
          never a division), which is why this is one unconditional call. */}
      <UsageMeter
        className={meterClassName}
        label="Context tokens"
        used={used ?? 0}
        limit={window ?? 0}
        tone="ramp"
        formatValue={formatTokens}
      />
      {line.length > 0 && (
        <p className="text-caption text-text-muted">{line.join(" · ")}</p>
      )}
    </div>
  );
}
