"use client";

import { ConfirmDialog } from "@/shared/ui/confirm-dialog";
import type { ChannelVisibility } from "../types";

/**
 * The private→public confirmation (C-13, Samuel 2026-08-10).
 *
 * WHY A DIALOG AT ALL. The visibility toggle used to PATCH on the click, with
 * no confirmation — while DELETE, which for a DM is reversible, got a full
 * destructive confirm. That is the asymmetry C-13 names: the reversible action
 * asked, and the one that publishes an entire private transcript to everyone in
 * the workspace did not. Going public is not undoable in the way that matters:
 * making it private again removes future access, not what has already been
 * read, so the copy says the history goes too rather than only the channel.
 *
 * ONE DIRECTION ONLY. public→private NARROWS the audience and needs no dialog —
 * `needsGoPublicConfirm` is what the host branches on, so the two decisions
 * (does this need a human? what does the human read?) live in one file next to
 * each other instead of being re-derived at the call site.
 *
 * ITS OWN FILE because both of its original hosts sat inside the §1 cap's last
 * few lines, and because this is the house pattern already: the menu reports
 * intent upward and the host renders the dialog beside the others
 * (`CreateChannelDialog`, `DirectMessageDialog`, `InviteDialog`). ⚠ The host
 * MOVED at the v2 cutover (2026-08-18) — it is
 * `channels-v2/channel-manage.tsx` now, and the same cap argument applies
 * there for the same reason.
 *
 * THE SERVER DOES NOT TRUST IT. `PATCH /api/channels/[channelId]` refuses the
 * `visibility` field outright for an agent caller (`SESSION_ONLY_FIELDS`), so
 * this dialog is the HUMAN's confirmation, not the enforcement.
 */
export function needsGoPublicConfirm(visibility: ChannelVisibility): boolean {
  return visibility === "private";
}

/**
 * THE COPY IS EXPORTED, not inlined in the JSX, because `ModalShell` portals
 * itself in from an effect — a static render of an open dialog is the empty
 * string, so there is no other way for a test to hold this wording to account.
 * Same split `GroupChannelRoutingNote` and `ChannelSettingsMenuView` use.
 * (`ChannelActionsMenuItems` was the third until its kebab was deleted for the
 * Settings tab's explicit rows, 2026-08-19.)
 */
export function goPublicTitle(displayName: string): string {
  return `Make "${displayName}" public?`;
}

export function goPublicDescription(displayName: string): string {
  return (
    `Every member of this workspace will be able to read "${displayName}" — ` +
    `the whole channel, including every message and thread already in it — ` +
    `and join it without an invite.\n` +
    `Making it private again later won't undo what people have read.`
  );
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The channel's display name — the same string the header renders. */
  displayName: string;
  /** Runs the visibility write. Only ever called for private→public. */
  onConfirm: () => void;
}

export function GoPublicDialog({
  open,
  onOpenChange,
  displayName,
  onConfirm,
}: Props) {
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={goPublicTitle(displayName)}
      description={goPublicDescription(displayName)}
      confirmLabel="Make public"
      destructive
      onConfirm={onConfirm}
    />
  );
}
