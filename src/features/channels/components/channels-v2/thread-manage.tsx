"use client";

/**
 * Channels v2 — THE THREAD-MANAGEMENT SURFACE (Samuel, 2026-08-21). The host
 * behind the right panel's Settings tab while a thread is open: the two writes, the
 * confirm dialog, and the one client-side step that has to happen BEFORE the
 * delete leaves.
 *
 * ⚠ IT IS `channel-manage.tsx`'s SHAPE, ONE SCOPE DOWN, and deliberately its own
 * file. That one owns the CHANNEL's dialogs, write hooks and gate; this owns the
 * THREAD's. Two reasons to change, two files (INVARIANTS §1) — and the split is
 * load-bearing rather than tidy: `channel-manage.tsx` mounts `useTrustRules`,
 * `useChannelPreferenceWrites` and `useChannelLifecycleWrites` on mount, so
 * branching INSIDE it would fire the channel's `/api/channels/trust` read every
 * time a reader opened Settings on a thread. The branch is at the mount boundary
 * instead (`settings-slot.tsx`).
 *
 * ⚠ THE WRITE HOOK TAKES THE PAGE'S `gate`, not a second coordinator — one
 * `useRefetchGate` per live surface, or a realtime doorbell mid-write reverts the
 * optimistic patch under the click that set it (INVARIANTS §7/§8).
 */

import { useState } from "react";
import { ConfirmDialog } from "@/shared/ui/confirm-dialog";
import type { MutationGate } from "@/shared/hooks/use-api-mutation";
import { getSpaBridge } from "@/shared/lib/spa-bridge";
import type { DesktopSessionSummary } from "@/shared/lib/spa-bridge";
import { useThreadLifecycleWrites } from "../../hooks/use-thread-lifecycle-writes";
import { useAgentControls } from "./agents-controls";
import { ownAgentsFor } from "./agents-model";
import { ChannelsV2ThreadSettingsTab } from "./thread-settings-tab";
import type { ChannelThread, ThreadMode } from "../../types";

export interface ChannelsV2ThreadManageProps {
  thread: ChannelThread;
  workspaceId: string;
  currentUserId: string;
  /** Channel owner or workspace admin — computed by the caller, which already
   *  holds both facts. ⚠ A DISPLAY gate; `service-tasks-delete.ts` is the fence. */
  canManageChannel: boolean;
  /** THIS MACHINE'S live session feed, or `null` for "could not ask" (a plain
   *  browser, or a main without it). ⚠ Carried as `null`, never collapsed to
   *  `[]` — see {@link endOwnAgentsOnThread}. */
  agentSessions: readonly DesktopSessionSummary[] | null;
  /** The page's ONE refetch coordinator — the writes below settle into it. */
  gate: MutationGate;
  /** The thread is gone — clear the selection back to channel view. */
  onDeleted: () => void;
}

export function ChannelsV2ThreadManageActions({
  thread,
  workspaceId,
  currentUserId,
  canManageChannel,
  agentSessions,
  gate,
  onDeleted,
}: ChannelsV2ThreadManageProps) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const control = useAgentControls();
  const writes = useThreadLifecycleWrites({
    workspaceId,
    gate,
    onDeleted: () => onDeleted(),
  });

  const isCreator = thread.createdBy === currentUserId;

  /**
   * STOP MY OWN AGENTS ON THIS THREAD, before the row they are standing on goes.
   *
   * ⚠ BEST-EFFORT AND SILENT BY DESIGN, which is the one place this family
   * departs from `agents-controls.ts`'s "never swallow main's verdict" rule. That
   * rule is about a CONTROL the operator pressed — a Pause that does nothing and
   * says nothing. Here the operator pressed Delete, the verdict they care about
   * is the delete's, and a refusal from `end` (no bridge in a plain browser, a
   * main that predates the op, an agent whose registry entry has already gone) is
   * not a reason to keep the thread. ⚠ It must never BLOCK the delete.
   *
   * ⚠ FEATURE DETECTION IS INSIDE `useAgentControls`, on the bridge member it is
   * about to call, and it answers `false` rather than throwing — so the web and
   * dev paths fall through here without a branch of their own.
   *
   * ⚠ ONE CALL PER AGENT, NOT ONE PER THREAD. `end` addresses `(channelId,
   * taskId)`, and since multiplayer agents (2026-08-21) that pair names a THREAD
   * rather than one agent — F-239. Looping the rows is what makes this end all of
   * them on a main that ends one per call; on a main that ends the whole thread at
   * once, the remaining calls are no-ops that return `false`.
   *
   * ⚠ PEERS ARE NOT REACHABLE AND ARE NOT ATTEMPTED. Every op here resolves
   * against THIS machine's registry (nobody ends another member's agent —
   * INVARIANTS §11). A peer's agent on the deleted thread dies on its own
   * idle/abandon timer; that is accepted (Samuel, 2026-08-21).
   *
   * ⚠ `null` sessions mean "could not ask", so there is nothing to end and this
   * does nothing — not the same as `[]`, but the same action.
   */
  async function endOwnAgentsOnThread(): Promise<void> {
    if (!agentSessions) return;
    for (const agent of ownAgentsFor(agentSessions, thread.channelId, thread.id)) {
      try {
        await control("end", { channelId: agent.channelId, taskId: agent.taskId });
      } catch {
        // A bridge that rejects is one more agent that outlives the thread by a
        // timeout. It is not a reason to leave the thread standing.
      }
    }
  }

  /**
   * ⚠ THE ORDER IS THE POINT: STOP, THEN DELETE. Reversed, the transcript goes
   * out from under a live session that is still posting into it, and its next post
   * lands tagged for a thread that no longer exists (`taskId` is caller-settable
   * and silently dropped when it names nothing, so the message would arrive in the
   * channel unthreaded rather than erroring).
   *
   * ⚠ `mutateAsync`, not `mutate`, because `ConfirmDialog` awaits this: it shows
   * the busy label for the whole stop-then-delete, closes on resolve, and STAYS
   * OPEN on a throw so a refused delete can be retried. The mutation's own
   * `onError` is what toasts the reason.
   */
  async function handleConfirmDelete(): Promise<void> {
    await endOwnAgentsOnThread();
    await writes.remove.mutateAsync({
      channelId: thread.channelId,
      threadId: thread.id,
    });
    // ⚠ AFTER the delete resolves, per `forgetThread`'s own contract: main cannot
    // observe the server cascade, so this drops the LOCAL 7-day ended-agent
    // history for the thread. Best-effort like the stop above — the delete
    // already succeeded, and a leftover card self-expires on the retention sweep.
    try {
      await getSpaBridge()?.sessions?.forgetThread?.(
        thread.channelId,
        thread.id
      );
    } catch {
      // A refusal here costs at most seven days of a stale local card.
    }
  }

  function handleSetMode(mode: ThreadMode) {
    if (mode === thread.mode) return;
    writes.setMode.mutate({
      channelId: thread.channelId,
      threadId: thread.id,
      mode,
    });
  }

  return (
    <>
      <ChannelsV2ThreadSettingsTab
        thread={thread}
        // Creator only — the server's own set-mode gate (a mode governs the
        // creator's machine), mirrored so the row is absent rather than inert.
        canSetMode={isCreator}
        canDelete={isCreator || canManageChannel}
        modeBusy={writes.setMode.pending}
        onSetMode={handleSetMode}
        onRequestDelete={() => setConfirmDelete(true)}
      />

      {/* Wording follows the CHANNEL delete's (`channel-manage.tsx`): what goes,
          who it goes for, and that it cannot be undone. The scope word is the
          only difference — a thread is deleted for everyone in THIS CHANNEL, not
          for the workspace. */}
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete thread?"
        description={`"${thread.title}" and all its messages will be permanently deleted for everyone in this channel. This can't be undone.`}
        confirmLabel="Delete permanently"
        destructive
        onConfirm={handleConfirmDelete}
      />
    </>
  );
}
