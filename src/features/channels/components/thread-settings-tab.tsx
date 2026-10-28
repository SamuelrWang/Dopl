"use client";

/**
 * Channels — the right panel's SETTINGS tab WHILE A THREAD IS OPEN (Samuel,
 * 2026-08-21).
 *
 * ⚠ IT REPLACES THE CHANNEL'S SETTINGS TAB, IT DOES NOT EXTEND IT. Same rule the
 * Info tab took the day before (`thread-info-tab.tsx`): in thread view the whole
 * right column is about the exchange the centre pane is showing, so the channel's
 * invite / visibility / delete / leave rows have no business standing in it. The
 * two are separate files because they answer two different questions; both are
 * built from `settings-agent-rows.tsx`'s vocabulary.
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
 * (`service-threads.ts › setThreadMode` — a mode governs the creator's own machine);
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
import { THREAD_MODE_LABELS } from "../constants";
import { SettingAction, SettingRow, SettingsSection } from "./settings-agent-rows";
import type { ChannelThread, ThreadMode } from "../types";

/** The two real modes, label-only. ⚠ Derived from the shared label map rather
 *  than re-typed, so the Info tab's read-out and this control cannot word one
 *  value two ways. */
const MODE_OPTIONS: ReadonlyArray<SelectMenuOption<ThreadMode>> = (
  ["interactive", "autonomous"] as const
).map((value) => ({ value, label: THREAD_MODE_LABELS[value] }));

interface ChannelsThreadSettingsTabProps {
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

export function ChannelsThreadSettingsTab({
  thread,
  canSetMode,
  canDelete,
  modeBusy = false,
  onSetMode,
  onRequestDelete,
}: ChannelsThreadSettingsTabProps) {
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
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3.5 pb-6 pt-3.5">
      <SettingsSection title="Thread">
        {canSetMode && (
          <SettingRow name="Mode">
            <SelectMenu<ThreadMode>
              variant="bare"
              value={thread.mode}
              options={MODE_OPTIONS}
              onChange={onSetMode}
              ariaLabel="How this thread is worked"
              disabled={modeBusy}
            />
          </SettingRow>
        )}
        {canDelete && (
          <SettingAction icon={Trash2} label="Delete thread" destructive onSelect={onRequestDelete} />
        )}
      </SettingsSection>
    </div>
  );
}
