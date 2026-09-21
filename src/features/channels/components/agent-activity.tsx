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

import { cn } from "@/shared/lib/utils";
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

/**
 * What one row says. ⚠ **THE NAME, AND NOTHING ELSE** (Samuel, 2026-09-20:
 * *"right now it says, [agent name] is working… remove the is working… just have
 * it be the flashing dot and the name of the agent"*).
 *
 * ⚠ **THE DOT ALREADY SAID IT, AND SAYING IT TWICE IS WHAT COST THE ROOM.** The
 * pulse is the "working" signal; the words repeated it once per agent, which is
 * the same one-fact-twice rule `AgentEndedPill` follows against a dot beside a
 * pill reading "Ended". With the strip now inline at the end of the recipient
 * line, three agents' worth of *"… is working…"* is also the difference between
 * fitting and eliding.
 * ⚠ **STILL PURE AND STILL EXPORTED**: `agentDisplayName` prefers the operator's
 * own rename, so a renamed agent must read by its new name the moment the feed
 * carries it.
 */
export function agentActivityText(agent: DesktopSessionSummary): string {
  return agentDisplayName(agent);
}

/**
 * **THE WORKING STRIP — one line, newest agent first, at the END OF THE
 * RECIPIENT LINE** (Samuel, 2026-09-20).
 *
 * 🔒 **IT WAS A STACK OF ROWS UNDER A HAIRLINE AND ALL THREE OF THOSE ARE GONE**:
 * *"no more line created, and instead of having it above the most recent, put
 * agents working to the right … instead of a green dot, have the dot be the
 * colour of that agent … if it runs off the page, just have it do `…`, no
 * scrolling necessary … for a new agent working, have it at the front"*.
 *
 * ⚠ **THE DOT CARRIES THE IDENTITY NOW, NOT THE STATE, AND ONLY HERE.** Green
 * said "working" beside text that also said "working"; the agent's own
 * `agent-01…16` key says WHICH agent, which is the fact a reader cannot get any
 * other way once the words are gone. **The Agents tab's dot stays `bg-success`**
 * — that surface lists idle, working and ended together, so there the dot is the
 * only thing carrying state. Two dots, two jobs, stated here because they now
 * differ on purpose.
 * ⚠ **THE PULSE STAYS.** It is what separates an identity mark from a live one,
 * and it is the half of the green dot that was never redundant.
 *
 * ⚠ **NEWEST FIRST IS A REVERSE, AND THE FEED'S ORDER IS WHY THAT IS EXACT.**
 * `main/session-summary.js › reportList` walks `deps.sessions.values()` — a `Map`,
 * so iteration is INSERTION order and the oldest live session is first. Reversing
 * it is therefore launch order newest-first, not an approximation of one; there is
 * no timestamp on this feed to sort by and inventing one would be a second
 * ordering to keep in step.
 * ⚠ **`…` IS `truncate`, AND THERE IS DELIBERATELY NO SCROLLER.** A strip that
 * scrolls is a control; this is a caption, and the operator who needs the full
 * list has the Agents tab.
 */
export function AgentActivityRows({
  agents,
  colors = null,
}: {
  /** Already scoped by {@link ownAgentsWorking} — this component does not decide. */
  agents: readonly DesktopSessionSummary[];
  /**
   * **EACH AGENT'S PAINT, ALREADY RESOLVED** — `agentId` → a `var()` reference.
   *
   * ⚠ **RESOLVED BY THE CALLER, exactly as `authored-row.tsx › AuthoredRowAccent`
   * is.** `lib/agent-colors.ts › agentColorVar` stays the one place the token name
   * is spelled and no colour appears in this component. A missing entry — an agent
   * the live set has not published a colour for — falls back to the neutral mark
   * rather than painting nothing at all.
   */
  colors?: ReadonlyMap<string, string> | null;
}) {
  if (agents.length === 0) return null;
  // ⚠ A COPY, NOT `.reverse()` ON THE ARGUMENT — the caller's array is the feed's
  // own derivation and several surfaces read it this render.
  const newestFirst = [...agents].reverse();
  return (
    <span className="flex min-w-0 items-center gap-2 truncate">
      {newestFirst.map((agent) => {
        const paint = agent.agentId ? (colors?.get(agent.agentId) ?? null) : null;
        return (
          <span
            // ⚠ KEYED ON THE BLENDED SLOT, not `agentId` alone — `agents-model.ts ›
            // agentKey` is `(channel, thread, agent)`, and since multiplayer one
            // operator can run several agents whose ids collide across threads.
            key={`${agent.channelId}:${agent.taskId}:${agent.agentId ?? agent.sessionId}`}
            role="status"
            className="flex min-w-0 shrink items-center gap-1.5"
          >
            <span
              aria-hidden
              className={cn(
                "h-1.5 w-1.5 shrink-0 animate-pulse rounded-full motion-reduce:animate-none",
                // ⚠ THE FALLBACK IS THE TRANSCRIPT'S OWN NEUTRAL, not green: an
                // uncoloured agent here is the same fact as an uncoloured agent
                // on a row (`agent-box-rule.ts › AGENT_ACCENT_NEUTRAL`).
                paint === null && "bg-border-strong"
              )}
              style={paint ? { backgroundColor: paint } : undefined}
            />
            <span className="min-w-0 truncate text-caption text-text-secondary">
              {agentActivityText(agent)}
            </span>
          </span>
        );
      })}
    </span>
  );
}
