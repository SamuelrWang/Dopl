import { useState } from "react";
import { channelRowId } from "./home-rows";
import type { OpenActivity } from "./overview-activity";

/**
 * JUMPING FROM AN OVERVIEW ACTIVITY ROW TO THE THING IT NAMES (2026-09-01).
 *
 * 🔒 **ON /home A JUMP IS A SELECTION, NOT A ROUTE, AND THAT IS FORCED BY THE
 * MODEL RATHER THAN CHOSEN.** A home channel lives in a `kind='link'`
 * CONTAINER, and containers have no page: the account rail drops them
 * (`index.tsx › selectStandardWorkspaces`), and `/{segment}/channels/{id}` is a
 * WORKSPACE route. What /home has instead is one record pane that mounts the
 * whole channels surface for the selected row
 * (`relationship-record.tsx`), so "open this thread" is three moves on this
 * page — pick the row, raise the Channels face, hand the surface the thread.
 *
 * ⚠ **THE HELD THREAD IS KEYED BY THE ROW IT WAS PICKED FOR**, which is what
 * makes {@link ActivityJump.threadFor} safe to call from the pane for ANY row:
 * a thread id only ever reaches the container it belongs to. Without the key a
 * jump into channel A would raise A's thread id inside channel B the moment the
 * selection moved — a 404 pane over a thread that exists.
 *
 * ⚠ **AND IT IS CLEARED ON A MANUAL PICK.** Clicking the left list is the
 * operator saying "take me to this channel", not "take me back to that thread";
 * leaving the jump armed would re-raise it every time the pane remounted.
 */
export interface ActivityJump {
  /** Hand to `HomeOverviewPanels` — see `overview-activity.tsx › OpenActivity`. */
  open: OpenActivity;
  /** The thread to raise when THIS row's record pane mounts, or `null`. */
  threadFor: (rowId: string) => string | null;
  /** Drop the held thread — the operator picked a row themselves. */
  clear: () => void;
}

export function useActivityJump({
  onSelect,
  onRaise,
}: {
  /** Select the row the jump lands on. */
  onSelect: (rowId: string) => void;
  /** Raise the face that renders the record pane — Channels. */
  onRaise: () => void;
}): ActivityJump {
  const [jump, setJump] = useState<{
    rowId: string;
    threadId: string | null;
  } | null>(null);

  return {
    open: (workspaceId, threadId) => {
      // ⚠ THE ROW ID IS MINTED, NEVER THE CONTAINER ID BARE. Home rows are
      // `rel:`/`link:`-prefixed (`home-rows.ts`), and the page's selection —
      // and its pane tokens — are keyed by that id.
      const rowId = channelRowId(workspaceId);
      setJump({ rowId, threadId });
      onSelect(rowId);
      onRaise();
    },
    threadFor: (rowId) => (jump?.rowId === rowId ? jump.threadId : null),
    clear: () => setJump(null),
  };
}
