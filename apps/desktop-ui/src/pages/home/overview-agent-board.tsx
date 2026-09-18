import type { HomeAgentRow } from "@/features/home/overview-types";
import {
  AgentBoard,
  type BoardAgent,
} from "#/components/overview/agent-board";
import type { OpenActivity } from "./use-activity-jump";

/**
 * /home Overview — **ACTIVE AGENTS**, the /home host of the shared board.
 *
 * ⚠ **THE BOARD MOVED TO `#/components/overview/agent-board.tsx` IN WAVE 8 AND
 * NOTHING ABOUT THIS FACE CHANGED (R-40).** The workspace Overview draws the
 * same lanes over its own container's sessions, and one picture with two
 * recipes is what P33 exists to stop. What is left here is the /home ADAPTER:
 * the lane key is the CONTAINER (a home channel has no route of its own, so the
 * jump is "select that row and raise the Channels face"), and every card is
 * openable — the read-only-peer arm is the workspace board's (R-25).
 */

/** `HomeAgentRow` → the board's structural row. ⚠ The container is the lane on
 *  this face; a workspace's lane is a CHANNEL. */
export function homeBoardRows(
  rows: readonly HomeAgentRow[]
): BoardAgent[] {
  return rows.map((row) => ({
    id: row.id,
    laneId: row.workspaceId,
    laneName: row.channelName,
    name: row.name,
    state: row.state,
    detail: row.detail,
    threadTitle: row.threadTitle,
    threadId: row.threadId,
    mine: row.mine,
    updatedAt: row.updatedAt,
  }));
}

export function ActiveAgentBoard({
  rows,
  onOpen,
}: {
  rows: readonly HomeAgentRow[];
  onOpen: OpenActivity;
}) {
  return (
    <AgentBoard
      rows={homeBoardRows(rows)}
      onOpen={(row) => onOpen(row.laneId, row.threadId)}
    />
  );
}
