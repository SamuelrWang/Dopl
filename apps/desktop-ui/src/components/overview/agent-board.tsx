import { Bot } from "lucide-react";
import { formatRelativeTime } from "@/shared/lib/format-time";

/**
 * THE ACTIVE-AGENT BOARD — one COLUMN PER ROOM, the one recipe both Overviews
 * draw their live agents with (Samuel, 2026-09-01; shared in wave 8, R-29(b)).
 *
 * ⚠ **THE BOARD VOCABULARY IS THE ONTOLOGY PAGE'S, ADAPTED RATHER THAN CLONED**
 * (Samuel's instruction, in those words). Taken from
 * `features/ontology/components/kanban-board.tsx` + `kanban-card.tsx`: a
 * horizontally scrolling row of `self-start` lanes, each a
 * `rounded-[14px] bg-bg-inset` well holding a header and a column of
 * `rounded-[10px]` bordered cards on `bg-bg-elevated`.
 * ⚠ **WHAT IS DELIBERATELY NOT COPIED IS THE ARITHMETIC.** That board's `w-72`
 * lane and `h-[216px]` card are sized for object cards with an eight-line clamp;
 * an agent card is a name, a state word and a thread. **Do not "restore" the
 * ontology numbers** — they are a measurement from a different board.
 *
 * ⚠ **A ROOM WITH NO LIVE AGENT HAS NO COLUMN** (Samuel). The board is "where is
 * work happening", so an empty lane is noise; the whole panel collapses when
 * nothing is running.
 *
 * ⚠ **"ACTIVE" IS THE REAL SESSION MODEL, NOT A WORD** — anything the desktop
 * has not reported as `ended`, which is what every other surface in the product
 * calls running (R-25, ruled 2026-09-17: everyone's LIVE agents, ended ones
 * hidden).
 *
 * ⚠ **EXTRACTED FROM `pages/home/overview-agent-board.tsx`, UNCHANGED.** R-40
 * keeps /home's face byte-identical: what this seam adds is
 * {@link AgentBoardProps.readOnlyPeers}, which /home does not pass.
 */

/**
 * WHAT THE SIX SITUATION KEYS SAY IN WORDS.
 *
 * ⚠ **A CLOSED MAP, AND AN UNKNOWN KEY RENDERS THE PLAIN STATE.** `detail` is
 * the ONE peer-visible telemetry column on `channel_sessions`, and it is
 * peer-visible *only because* this vocabulary is closed
 * (`20260822150000_channel_sessions_telemetry.sql`). The server already narrows
 * it; this map is the second half of the same rule, so a seventh key shipped by
 * a newer desktop degrades to the state word instead of printing a raw token.
 */
const DETAIL_WORD: Record<string, string> = {
  thinking: "Thinking",
  tool: "Running a tool",
  posting: "Posting",
  permission: "Waiting on permission",
  awaiting_peer: "Waiting on a peer",
  awaiting_inbound: "Waiting on a reply",
};

/**
 * The minimum structural shape this board reads.
 *
 * 🔒 **NAME, STATE, THREAD — AND NOTHING ELSE.** There is no model, no tool
 * label, no token or context figure here, and their absence is a rule rather
 * than a layout choice: those are the OPERATOR-ONLY telemetry columns, and the
 * ruling (R-29's privacy half) is that a peer learns THAT an agent is working
 * and never what it costs its operator. Neither payload carries them, so this
 * component could not render them — which is the shape the fence should have.
 * ⚠ **Do not widen this interface.**
 */
export interface BoardAgent {
  id: string;
  /** The lane's key — a CONTAINER on /home, a CHANNEL in a workspace. */
  laneId: string;
  laneName: string;
  name: string;
  state: string;
  detail: string | null;
  threadTitle: string | null;
  threadId: string | null;
  /** TRUE when this session runs on the CALLER'S machine. ⚠ A boolean rather
   *  than a name for the same reason the card omits the telemetry: telling
   *  "mine" from "theirs" does not require identifying the peer. */
  mine: boolean;
  updatedAt: string;
}

interface Lane {
  id: string;
  name: string;
  agents: BoardAgent[];
}

/**
 * Rows → one lane per room that has at least one.
 *
 * ⚠ **INSERTION ORDER IS THE SERVER'S ORDER, so the busiest-most-recent room
 * leads.** Both payloads are already sorted by `updated_at` descending, and a
 * `Map` preserves insertion order — so the first lane is the one whose agent
 * moved most recently, which is the reading order somebody scanning a board
 * wants. Re-sorting by name here would bury the live room behind an alphabet.
 */
export function agentLanes(rows: readonly BoardAgent[]): Lane[] {
  const lanes = new Map<string, Lane>();
  for (const row of rows) {
    const found = lanes.get(row.laneId);
    if (found) {
      found.agents.push(row);
      continue;
    }
    lanes.set(row.laneId, {
      id: row.laneId,
      name: row.laneName || "Untitled channel",
      agents: [row],
    });
  }
  return [...lanes.values()];
}

export interface AgentBoardProps {
  rows: readonly BoardAgent[];
  /** Open the row's thread (or its room, for a room-level launch). */
  onOpen: (row: BoardAgent) => void;
  /**
   * 🔒 **R-25's second half: a PEER's row is state, not a destination.** The
   * workspace board lists every member's live agent, and a card that navigated
   * into somebody else's thread would make a read-only surface a jump into a
   * room the reader may have no business in. /home does not pass this — its
   * board has always been openable end to end and R-40 keeps it that way.
   */
  readOnlyPeers?: boolean;
}

export function AgentBoard({ rows, onOpen, readOnlyPeers }: AgentBoardProps) {
  const lanes = agentLanes(rows);
  // 🔒 **AN EMPTY BOARD RENDERS NOTHING AT ALL, and the CALLER folds the card
  // away** (Samuel, 2026-09-01: an empty state must not cost a full-width
  // panel). "None running." belongs on one line inside a card that has other
  // reasons to exist — this component has none.
  if (lanes.length === 0) return null;

  return (
    // ⚠ THE BOARD SCROLLS, THE LANES DO NOT. Same rule the ontology board
    // states: a lane hugs its cards and the row of lanes is the scroller, so a
    // room with six agents makes its own lane tall instead of growing an inner
    // scrollbar nobody can see the bottom of.
    <div className="flex items-start gap-2.5 overflow-x-auto pb-1">
      {lanes.map((lane) => (
        <section
          key={lane.id}
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
              <AgentCard
                key={agent.id}
                agent={agent}
                onOpen={
                  readOnlyPeers && !agent.mine ? undefined : () => onOpen(agent)
                }
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

const CARD_FACE =
  "flex w-full flex-col items-start gap-0.5 rounded-[10px] border border-border-subtle bg-bg-elevated px-2 py-1.5 text-left";

/** One agent. ⚠ The FACE is one string for both arms — a read-only card that
 *  drifted from the openable one would read as a different kind of thing. */
function AgentCard({
  agent,
  onOpen,
}: {
  agent: BoardAgent;
  /** Absent = read-only (a peer's row on the workspace board). */
  onOpen?: () => void;
}) {
  const body = (
    <>
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
            A room-level launch has none and says so rather than borrowing the
            room's name, which would read as a thread that does not exist. */}
        <span className="min-w-0 truncate text-micro text-text-muted">
          {agent.threadTitle || "Channel"}
        </span>
        <span className="shrink-0 font-mono text-micro tabular-nums text-text-muted">
          {formatRelativeTime(agent.updatedAt)}
        </span>
      </span>
    </>
  );
  if (!onOpen) {
    return <div className={CARD_FACE}>{body}</div>;
  }
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`${CARD_FACE} cursor-pointer hover:border-border-strong`}
    >
      {body}
    </button>
  );
}
