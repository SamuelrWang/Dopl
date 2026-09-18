import { useNavigate } from "react-router";
import { SectionPanel } from "@/shared/ui/section-panel";
import type { OverviewAgentRow } from "@/features/workspaces/types";
import {
  AgentBoard,
  type BoardAgent,
} from "#/components/overview/agent-board";

/**
 * THE WORKSPACE OVERVIEW'S LIVE AGENT BOARD — everyone's running agents in this
 * container (wave 8; R-25 semantics, ruled 2026-09-17: **every member's LIVE
 * agent is listed and an ENDED one is not**).
 *
 * 🔒 **A PEER'S ROW IS READ-ONLY.** The board answers *where is work happening*;
 * a card that navigated into a colleague's thread would turn a state surface
 * into a jump, and the caller's channel membership — not this list — is what
 * decides which rooms they may open. Only the caller's OWN rows are buttons.
 * ⚠ The board is already viewer-filtered server-side (a session in a channel the
 * caller cannot see never reaches the payload); this is the second half.
 *
 * 🔒 **THE CARD CARRIES NO MODEL, TOOL LABEL, TOKEN OR CONTEXT FIGURE** — R-29's
 * privacy half, and the payload does not carry them either
 * (`workspaces/types.ts › OverviewAgentRow`).
 *
 * ⚠ **THE WHOLE PANEL FOLDS AWAY WHEN NOTHING IS RUNNING** — the rule /home's
 * Activity panel already follows. A heading over an empty box is the exact
 * defect the first Overview attempt was rejected for.
 */
export function AgentBoardPanel({
  rows,
  segment,
}: {
  rows: readonly OverviewAgentRow[];
  /** `{slug}-{publicId}` — what a channel route is addressed by. */
  segment: string;
}) {
  const navigate = useNavigate();
  if (rows.length === 0) return null;
  return (
    <SectionPanel id="workspace-overview-agents" label="Active agents">
      <AgentBoard
        rows={rows.map(boardRow)}
        readOnlyPeers
        onOpen={(row) =>
          navigate(`/${segment}/channels/${encodeURIComponent(row.laneId)}`)
        }
      />
    </SectionPanel>
  );
}

/** ⚠ The lane is a CHANNEL here; on /home it is the container, because a home
 *  channel has no route of its own. */
function boardRow(row: OverviewAgentRow): BoardAgent {
  return {
    id: row.id,
    laneId: row.channelId,
    laneName: row.channelName,
    name: row.name,
    state: row.state,
    detail: row.detail,
    threadTitle: row.threadTitle,
    threadId: row.threadId,
    mine: row.mine,
    updatedAt: row.updatedAt,
  };
}
