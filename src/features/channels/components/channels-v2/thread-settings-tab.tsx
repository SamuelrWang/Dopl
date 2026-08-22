"use client";

/**
 * Channels v2 — the right panel's SETTINGS tab WHILE A THREAD IS OPEN (Samuel,
 * 2026-08-21).
 *
 * ⚠ IT REPLACES THE CHANNEL'S SETTINGS TAB, IT DOES NOT EXTEND IT. Same rule the
 * Info tab took the day before (`thread-info-tab.tsx`): in thread view the whole
 * right column is about the exchange the centre pane is showing, so the channel's
 * invite / visibility / archive / trust rows have no business standing in it.
 * `settings-tab.tsx` is untouched and still renders verbatim in channel view; the
 * two are separate files because they answer two different questions.
 *
 * ⚠ EVERYTHING A THREAD ACTUALLY HAS IS HERE, WHICH IS TWO THINGS. A thread is a
 * titled, mode-tagged exchange between two fixed parties (INVARIANTS §5) — the
 * title and the parties are fixed at open and the mode is the one field anybody
 * may still move, so the settings are MODE and DELETE and there is nothing else
 * to put beside them. **No status row and no close**: a thread has no finished
 * state on any surface, and Delete is not one — it makes the thread stop
 * EXISTING rather than mark it done.
 *
 * ⚠ NO DEAD ROWS (INVARIANTS §5). Mode is CREATOR-only, because the server is
 * (`service-tasks.ts › setTaskMode` — a mode governs the creator's own machine);
 * Delete is creator-or-channel-manager. A reader entitled to neither gets the
 * empty state, not a heading over greyed-out controls. ⚠ These gates are a
 * DISPLAY convenience — the service refuses regardless, and it is the fence.
 *
 * ⚠ MINIMAL COPY (Samuel, 2026-08-19, still binding): a row is a NAME plus a
 * CONTROL. No per-option sentences under Mode, no paragraph anywhere. The
 * destructive row's full sentence lives in its CONFIRM DIALOG, which is where a
 * person is actually deciding.
 */

import { Trash2 } from "lucide-react";
import { EmptyState } from "@/shared/ui/empty-state";
import { SelectMenu, type SelectMenuOption } from "@/shared/ui/select-menu";
import { cn } from "@/shared/lib/utils";
import { THREAD_MODE_LABELS } from "../../constants";
import { PanelHeading } from "./bits";
import type { ChannelThread, ThreadMode } from "../../types";

/** The two real modes, label-only. ⚠ Derived from the shared label map rather
 *  than re-typed, so the Info tab's read-out and this control cannot word one
 *  value two ways. */
const MODE_OPTIONS: ReadonlyArray<SelectMenuOption<ThreadMode>> = (
  ["interactive", "autonomous"] as const
).map((value) => ({ value, label: THREAD_MODE_LABELS[value] }));

export interface ChannelsV2ThreadSettingsTabProps {
  thread: ChannelThread;
  /** Creator only — mirrors the server's set-mode gate. */
  canSetMode: boolean;
  /** Creator, or someone who can manage the channel. */
  canDelete: boolean;
  /** A set-mode write is in flight — disables the control, nothing else. */
  modeBusy?: boolean;
  onSetMode: (mode: ThreadMode) => void;
  /** Opens the delete CONFIRMATION — this tab never deletes directly, exactly as
   *  `settings-tab.tsx` never does. */
  onRequestDelete: () => void;
}

export function ChannelsV2ThreadSettingsTab({
  thread,
  canSetMode,
  canDelete,
  modeBusy = false,
  onSetMode,
  onRequestDelete,
}: ChannelsV2ThreadSettingsTabProps) {
  if (!canSetMode && !canDelete) {
    return (
      <EmptyState
        icon={Trash2}
        title="Nothing to manage"
        description="Only this thread's opener or a channel manager can change it."
      />
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto pb-6">
      <PanelHeading title="Thread" />
      <div className="flex flex-col gap-px px-2">
        {canSetMode && (
          <div className="flex min-h-[40px] items-center gap-2 px-2">
            <span className="shrink-0 text-body font-medium text-text-primary">
              Mode
            </span>
            <span className="flex min-w-0 flex-1 justify-end">
              <SelectMenu<ThreadMode>
                value={thread.mode}
                options={MODE_OPTIONS}
                onChange={onSetMode}
                ariaLabel="How this thread is worked"
                disabled={modeBusy}
              />
            </span>
          </div>
        )}
        {canDelete && (
          <button
            type="button"
            onClick={onRequestDelete}
            // ⚠ The ACTION-ROW recipe from `settings-tab.tsx › ActionRow`,
            // repeated rather than imported: that component is private to the
            // channel tab and exporting it would make one file the other's
            // layout dependency for four utility classes. If a third caller ever
            // appears, promote it to `bits.tsx` instead of chaining imports.
            // `destructive` is INK ONLY — the click opens a dialog.
            className={cn(
              "flex h-10 w-full items-center gap-2 rounded-[8px] px-2 text-left text-small transition-colors",
              "text-danger hover:bg-danger/10"
            )}
          >
            <Trash2 size={14} className="shrink-0" />
            <span className="truncate">Delete thread</span>
          </button>
        )}
      </div>
    </div>
  );
}
