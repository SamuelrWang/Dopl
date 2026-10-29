import { useState } from "react";
import { channelRowId } from "@/features/home/components/channels/home-rows";

/**
 * JUMPING FROM A ROW TO THE THING IT NAMES (2026-09-01).
 *
 * Callers: the SEARCH popup (`index.tsx › openSearchHit`), the Overview's Needs
 * you card (a decision lands on its message, a task on the Tasks tab), and an
 * arrival from outside /home (`home-intent.ts`, 2026-10-29). `threadFor`/`seqFor`/`taskFor` are read by the record pane on
 * every render (`home-panes.tsx`).
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
/**
 * What a row DOES when it is clicked.
 *
 * ⚠ **THE TYPE LIVES WITH THE HOOK, NOT WITH A CARD (2026-09-05).** It moved
 * here when **Waiting on you** and **Recent threads** were cut and
 * `overview-activity.tsx` went with them: it describes the JUMP, and the jump is
 * this hook's argument — parking it on whichever component happens to render a
 * row is how it ended up outliving one. ⚠ **That call was made twice over on
 * 2026-09-20**, when the Activity panel — the agent board that inherited the
 * type — was itself deleted and this type simply changed callers again.
 */
export type OpenActivity = (
  workspaceId: string,
  /** `null` opens the channel with no thread raised. */
  threadId: string | null,
  /**
   * A `channel_messages.seq` to land the transcript ON (F-714) — a search row
   * on a message, or a Needs you decision. `null`/absent leaves the transcript
   * where the surface puts it.
   */
  seq?: number | null
) => void;

export interface ActivityJump {
  /** Hand to whatever opens a row. See {@link OpenActivity}. */
  open: OpenActivity;
  /** The thread to raise when THIS row's record pane mounts, or `null`. */
  threadFor: (rowId: string) => string | null;
  /** The message seq to land on when THIS row's pane mounts, or `null`. ⚠ Keyed
   *  by the row for `threadFor`'s reason: a seq is a coordinate INSIDE one
   *  channel's transcript and means nothing in another's. */
  seqFor: (rowId: string) => number | null;
  /** Open a channel on its Tasks tab, on one task — a Needs you task row. */
  openTask: (workspaceId: string, taskId: string) => void;
  /** The task to open when THIS row's record pane mounts, or `null`. Keyed by the row, like `threadFor`. */
  taskFor: (rowId: string) => string | null;
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
    seq: number | null;
    taskId: string | null;
  } | null>(null);

  const land = (workspaceId: string, target: Omit<NonNullable<typeof jump>, "rowId">) => {
    // ⚠ THE ROW ID IS MINTED, NEVER THE CONTAINER ID BARE. Home rows are
    // `rel:`/`link:`-prefixed (`home-rows.ts`), and the page's selection —
    // and its pane tokens — are keyed by that id.
    const rowId = channelRowId(workspaceId);
    setJump({ rowId, ...target });
    onSelect(rowId);
    onRaise();
  };

  return {
    open: (workspaceId, threadId, seq = null) => land(workspaceId, { threadId, seq, taskId: null }),
    openTask: (workspaceId, taskId) => land(workspaceId, { threadId: null, seq: null, taskId }),
    threadFor: (rowId) => (jump?.rowId === rowId ? jump.threadId : null),
    seqFor: (rowId) => (jump?.rowId === rowId ? jump.seq : null),
    taskFor: (rowId) => (jump?.rowId === rowId ? jump.taskId : null),
    clear: () => setJump(null),
  };
}
