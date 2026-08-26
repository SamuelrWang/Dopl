"use client";

/**
 * "AGENT #AB12 IS WORKING…" — MY OWN agents' activity rows above the composer
 * (Samuel, 2026-08-25).
 *
 * ⚠ IT IS THE OWN-SIDE TWIN OF `peer-activity.tsx`, and the two are deliberately
 * NOT one component. They answer the same question about different machines and
 * they fail in opposite directions:
 *   - A PEER row is a cross-machine claim over `channel_sessions`, whose rows
 *     outlive the process that wrote them — so it carries a freshness window and
 *     goes SILENT when a row ages out (a reader must never wait on a machine that
 *     is gone).
 *   - THIS row reads the LOCAL bridge feed, which is the live registry of this
 *     machine's own sessions. **Liveness is membership**: a session that ended is
 *     gone from the feed, not stale in it, so there is no clock to consult and a
 *     freshness window here would be inventing doubt about a fact we hold
 *     directly.
 * Merging them would force one of those two rules onto the other.
 *
 * ⚠ ONE ROW PER AGENT, STACKED — not "3 agents are working…" (Samuel's ruling).
 * The peer row collapses above one because it cannot say anything useful about
 * WHICH peer agent; this side can, because these are the operator's own agents
 * and they have names the operator chose. A count would throw away the one thing
 * that makes the row actionable.
 *
 * ⚠ "IS WORKING…" IS THE SAME WORD THE PEER ROW USES, on purpose. The local feed
 * carries a finer signal (`agents-model.ts › agentDetailLabel` over `detail` —
 * "thinking", a tool name, "posting") and the Agents tab and the agent panel both
 * render it. **A caption beside the composer is not where that belongs**: it
 * flickers once per tool call, and two vocabularies for "this agent is busy" on
 * one screen is the F-142 shape ("the web chip shows Idle while the desktop
 * works"). One word here, the detail one click away.
 */

import type { DesktopSessionSummary } from "@/shared/lib/spa-bridge";
import { agentDisplayName, ownAgentsFor } from "./agents-model";

/**
 * MY agents mid-turn on the surface as it is currently scoped. Pure and exported
 * for the test.
 *
 * ⚠ `state === "working"` IS THE ACTIVE-TURN SIGNAL, and it is a real one rather
 * than the closest available approximation. The bridge feed's state is
 * `working | idle | ended` and `agents-model.ts › agentLiveness` already treats
 * `working` as mid-turn everywhere else on this surface; main moves a session
 * OUT of `working` when the turn settles (`session-reducer.js`), so the row
 * disappears on its own with no timer here. **An `idle` agent is listening, not
 * working**, and a row for it would be a permanent band over every channel that
 * has ever launched one.
 *
 * ⚠ THE SCOPE IS `ownAgentsFor`, NOT A FILTER WRITTEN HERE (2026-08-20's rule).
 * That helper is the ONE derivation of "my agents on this surface as scoped" —
 * the Agents tab's list and its badge both run it — and a second inline copy is
 * exactly the two-readers-one-truth defect F-142 records. Channel view shows
 * every agent in the channel; thread view narrows to the open thread, which is
 * what makes the row track the composer's own target.
 *
 * ⚠ `null` SESSIONS RENDER NOTHING, and that is not the same as an empty list.
 * `null` is "could not ask" — a plain browser, or a main without the feed
 * (INVARIANTS §11: UNKNOWN is not EMPTY). An indicator is a POSITIVE claim that
 * something is happening right now; a surface that cannot ask has no business
 * making it.
 */
export function ownAgentsWorking(
  sessions: readonly DesktopSessionSummary[] | null,
  channelId: string,
  openThreadId: string | null = null
): DesktopSessionSummary[] {
  if (!sessions) return [];
  return ownAgentsFor(sessions, channelId, openThreadId).filter(
    (agent) => agent.state === "working"
  );
}

/** What one row says. ⚠ Pure and exported: the NAME is the whole point of the
 *  row, and `agentDisplayName` prefers the operator's own rename — so a renamed
 *  agent must read by its new name here the moment the feed carries it. */
export function agentActivityText(agent: DesktopSessionSummary): string {
  return `${agentDisplayName(agent)} is working…`;
}

/**
 * The rows. Renders NOTHING when nothing is working, rather than an empty
 * reserved strip — this sits directly above the composer, and a permanent blank
 * band there is chrome every channel pays for forever.
 *
 * ⚠ THERE IS NO FRESHNESS GUARD HERE AND ITS ABSENCE IS THE DESIGN.
 * `peer-activity.tsx` compares against `PRESENCE_ONLINE_WINDOW_MS` because a
 * `channel_sessions` row outlives the process that wrote it. The local feed has
 * no such failure mode — see this file's header — so a window here would be
 * inventing doubt about a fact this machine holds directly. Stated rather than
 * left as an absence, because the asymmetry reads as an oversight otherwise.
 */
export function AgentActivityRows({
  agents,
}: {
  /** Already scoped by {@link ownAgentsWorking} — this component does not decide. */
  agents: readonly DesktopSessionSummary[];
}) {
  if (agents.length === 0) return null;
  return (
    <div className="flex shrink-0 flex-col border-t border-border-subtle">
      {agents.map((agent) => (
        <div
          // ⚠ KEYED ON THE BLENDED SLOT, not `agentId` alone — `agents-model.ts ›
          // agentKey` is `(channel, thread, agent)`, and since multiplayer one
          // operator can run several agents whose ids collide across threads.
          key={`${agent.channelId}:${agent.taskId}:${agent.agentId ?? agent.sessionId}`}
          role="status"
          className="flex items-center gap-2 px-8 py-1.5"
        >
          <span
            aria-hidden
            className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-success motion-reduce:animate-none"
          />
          <span className="min-w-0 truncate text-caption text-text-secondary">
            {agentActivityText(agent)}
          </span>
        </div>
      ))}
    </div>
  );
}
