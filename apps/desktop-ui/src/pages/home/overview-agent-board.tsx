import { Bot } from "lucide-react";
import { formatRelativeTime } from "@/shared/lib/format-time";
import type { HomeAgentRow } from "@/features/home/overview-types";
import type { OpenActivity } from "./overview-activity";

/**
 * /home Overview — **ACTIVE AGENTS**, a board with one COLUMN PER CHANNEL
 * (Samuel, 2026-09-01), the third panel that replaced the row of stat tiles.
 *
 * ⚠ **THE BOARD VOCABULARY IS THE ONTOLOGY PAGE'S, ADAPTED RATHER THAN CLONED**
 * (Samuel's instruction, in those words). Taken from
 * `features/ontology/components/kanban-board.tsx` + `kanban-card.tsx`: a
 * horizontally scrolling row of `self-start` lanes, each a
 * `rounded-[14px] bg-bg-inset` well holding a header and a column of
 * `rounded-[10px]` bordered cards on `bg-bg-elevated`.
 * ⚠ **WHAT IS DELIBERATELY NOT COPIED IS THE ARITHMETIC.** That board's
 * `w-72` lane and `h-[216px]` card are sized for object cards with an
 * eight-line clamp, derived from a 12px dot pitch; an agent card is a name, a
 * state word and a thread. These lanes are narrower and the cards hug their
 * content, so **do not "restore" the ontology numbers** — they would be a
 * measurement from a different board.
 *
 * ⚠ **A CHANNEL WITH NO LIVE AGENT HAS NO COLUMN** (Samuel). The board is
 * "where is work happening", so an empty lane is noise; the whole panel
 * collapses to one line when nothing is running.
 *
 * ⚠ **"ACTIVE" IS THE REAL SESSION MODEL, NOT A WORD.** The payload carries
 * anything the desktop has not reported as `ended` (`repository-overview.ts ›
 * listRunningSessions`, `state != 'ended'`), which is exactly what every other
 * surface in the product calls running.
 */

/**
 * WHAT THE SIX SITUATION KEYS SAY IN WORDS.
 *
 * ⚠ **A CLOSED MAP, AND AN UNKNOWN KEY RENDERS THE PLAIN STATE.** `detail` is
 * the ONE peer-visible telemetry column on `channel_sessions`, and it is
 * peer-visible *only because* this vocabulary is closed
 * (`20260822150000_channel_sessions_telemetry.sql`). The server already narrows
 * it (`overview-tally.ts › narrowDetail`); this map is the second half of the
 * same rule, so a seventh key shipped by a newer desktop degrades to the state
 * word instead of printing a raw token at the operator.
 */
const DETAIL_WORD: Record<string, string> = {
  thinking: "Thinking",
  tool: "Running a tool",
  posting: "Posting",
  permission: "Waiting on permission",
  awaiting_peer: "Waiting on a peer",
  awaiting_inbound: "Waiting on a reply",
};

interface Lane {
  workspaceId: string;
  name: string;
  agents: HomeAgentRow[];
}

/**
 * Rows → one lane per channel that has at least one.
 *
 * ⚠ **INSERTION ORDER IS THE SERVER'S ORDER, so the busiest-most-recent channel
 * leads.** The payload is already sorted by `updated_at` descending, and a `Map`
 * preserves insertion order — so the first lane is the one whose agent moved
 * most recently, which is the reading order somebody scanning a board wants.
 * Re-sorting by name here would bury the live channel behind an alphabet.
 */
export function agentLanes(rows: readonly HomeAgentRow[]): Lane[] {
  const lanes = new Map<string, Lane>();
  for (const row of rows) {
    const found = lanes.get(row.workspaceId);
    if (found) {
      found.agents.push(row);
      continue;
    }
    lanes.set(row.workspaceId, {
      workspaceId: row.workspaceId,
      name: row.channelName || "Untitled channel",
      agents: [row],
    });
  }
  return [...lanes.values()];
}

export function ActiveAgentBoard({
  rows,
  onOpen,
}: {
  rows: readonly HomeAgentRow[];
  onOpen: OpenActivity;
}) {
  const lanes = agentLanes(rows);
  // 🔒 **AN EMPTY BOARD RENDERS NOTHING AT ALL, and the CALLER folds the card
  // away** (Samuel, 2026-09-01, on the first attempt's layout: an empty state
  // must not cost a full-width panel). "None running." belongs on one line
  // inside a card that has other reasons to exist — this component has none.
  if (lanes.length === 0) return null;

  return (
    // ⚠ THE BOARD SCROLLS, THE LANES DO NOT. Same rule the ontology board
    // states: a lane hugs its cards and the row of lanes is the scroller, so a
    // channel with six agents makes its own lane tall instead of growing an
    // inner scrollbar nobody can see the bottom of.
    <div className="flex items-start gap-2.5 overflow-x-auto pb-1">
      {lanes.map((lane) => (
        <section
          key={lane.workspaceId}
          className="flex w-52 shrink-0 flex-col gap-1.5 self-start rounded-[14px] bg-bg-inset p-2"
        >
          <header className="flex items-baseline justify-between gap-2 px-0.5">
            <h4 className="min-w-0 truncate text-label font-semibold uppercase tracking-wide text-text-secondary">
              {lane.name}
            </h4>
            <span className="shrink-0 font-mono text-micro tabular-nums text-text-muted">
              {lane.agents.length}
            </span>
          </header>
          <div className="flex flex-col gap-1.5">
            {lane.agents.map((agent) => (
              <AgentCard key={agent.id} agent={agent} onOpen={onOpen} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

/**
 * One agent.
 *
 * 🔒 **NAME, STATE, THREAD — AND NOTHING ELSE.** There is no model, no tool
 * label, no token or context figure on this card, and their absence is a rule
 * rather than a layout choice: those are the OPERATOR-ONLY telemetry columns, a
 * home container holds another PERSON, and Samuel's ruling is that a peer learns
 * THAT an agent is working and never what it costs its operator. The payload
 * does not carry them (`HomeAgentRow`), so this component could not render them
 * — which is the shape the fence is supposed to have.
 *
 * ⚠ `mine` IS THE ONLY THING SEPARATING THE CALLER'S AGENTS FROM A PEER'S, and
 * it is a boolean rather than a name for the same reason: telling them apart
 * does not require identifying the peer.
 */
function AgentCard({
  agent,
  onOpen,
}: {
  agent: HomeAgentRow;
  onOpen: OpenActivity;
}) {
  return (
    <button
      type="button"
      onClick={() => onOpen(agent.workspaceId, agent.threadId)}
      className="flex w-full cursor-pointer flex-col items-start gap-0.5 rounded-[10px] border border-border-subtle bg-bg-elevated px-2 py-1.5 text-left hover:border-border-strong"
    >
      <span className="flex w-full items-center gap-1.5">
        <Bot size={12} className="shrink-0 text-text-muted" aria-hidden />
        <span className="min-w-0 flex-1 truncate text-body font-medium text-text-primary">
          {agent.name}
        </span>
        {!agent.mine && (
          <span className="shrink-0 rounded-full bg-bg-inset px-1.5 text-micro font-medium text-text-secondary">
            Peer
          </span>
        )}
      </span>
      {/* The situation when the desktop reported a recognised one, the bare
          state otherwise — never a raw key. */}
      <span className="w-full truncate text-caption text-text-secondary">
        {DETAIL_WORD[agent.detail ?? ""] ?? agent.state}
      </span>
      <span className="flex w-full items-baseline justify-between gap-2">
        {/* ⚠ THE THREAD IS THE CARD'S SECOND FACT (Samuel asked for it by name).
            A channel-level launch has none and says so rather than borrowing the
            channel's name, which would read as a thread that does not exist. */}
        <span className="min-w-0 truncate text-micro text-text-muted">
          {agent.threadTitle || "Channel"}
        </span>
        <span className="shrink-0 font-mono text-micro tabular-nums text-text-muted">
          {formatRelativeTime(agent.updatedAt)}
        </span>
      </span>
    </button>
  );
}
