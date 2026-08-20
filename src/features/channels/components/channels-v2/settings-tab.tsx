"use client";

/**
 * Channels v2 — the right panel's SETTINGS tab (Samuel, 2026-08-19).
 *
 * ⚠ THIS TAB IS WHERE THE PANE HEADER'S ACTION CLUSTER WENT. `message-pane.tsx`
 * used to carry six controls on the right of the breadcrumb — channel settings,
 * the working folder, invite, the kebab, an inert sparkle and the info toggle.
 * The ruling is that the CHANNEL header keeps only the info toggle, so the four
 * live ones moved here and the sparkle was deleted (it had no handler). **The
 * tab that used to sit in this slot was LINKS, a deliberate empty state**
 * ("No links in this channel yet."), and it dies with the rename rather than
 * being rehomed: where a channel's files and links land is still an open
 * question (wiring plan, Risk 10) and an empty tab was answering it with "here".
 *
 * ⚠ THE POPOVERS ARE GONE — SECOND RULING, SAME DAY (Samuel, live review).
 * The first pass carried `ChannelSettingsPopover` and `ChannelFolderControl`
 * AS-IS, each behind a 7×7 icon button, and left their product fate open. It is
 * settled now: **every setting is INLINE, visible without a click** — see
 * `settings-agent.tsx`, which holds the arm, the tool profile, the folder and
 * the trust roster, and which both popover files were DELETED for. Nothing
 * below is new product surface; the writes are the ones that already existed.
 * The kebab changed shape at the same cutover: `ChannelActionsMenu` was deleted
 * and its four items are the explicit rows here, because a kebab nested inside a
 * tab is a menu hiding inside a menu. **The destructive pair still routes
 * through the confirm dialogs** — these rows report intent upward exactly as the
 * menu items did, and `channel-manage.tsx` still owns every dialog.
 *
 * ⚠ NO DEAD ROWS (INVARIANTS §5 — every row on this surface functions). The
 * desktop-only controls are gated on their own bridge INSIDE `settings-agent`,
 * so a plain browser gets no labelled row with nothing in it, and a non-member
 * viewing a public channel gets the empty state rather than a heading over
 * nothing.
 */

import {
  Archive,
  ArchiveRestore,
  Hash,
  LogOut,
  Settings2,
  Trash2,
  UserPlus,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { EmptyState } from "@/shared/ui/empty-state";
import { cn } from "@/shared/lib/utils";
import { PanelHeading } from "./bits";
import type { Channel } from "../../types";

export interface ChannelsV2SettingsTabProps {
  channel: Channel;
  /** True for the channel owner — gates the manage half, as the kebab did. */
  canManage: boolean;
  /**
   * `settings-agent.tsx › ChannelAgentSettings`, injected as a SLOT: it needs
   * the roster, the trust set and three write handlers, all of which live in
   * `channel-manage.tsx`. `null` for a non-member, who has no agent settings of
   * their own here — and its absence is what turns this tab into the empty
   * state rather than a heading over nothing.
   *
   * ⚠ IT IS THE WHOLE AGENT + ALWAYS-ALLOW HALF, headings included, not a
   * control dropped into a row of this file's making. That is the shape change
   * the inlining ruling forced: there is no longer a single icon-button to hang
   * off a label.
   */
  agent?: ReactNode;
  onInvite: () => void;
  onToggleVisibility: () => void;
  onToggleArchive: () => void;
  /** Opens the delete CONFIRMATION — this tab never deletes directly. */
  onRequestDelete: () => void;
  /**
   * Opens the leave CONFIRMATION. ⚠ Leaving is a real membership DELETE and on a
   * private channel the user cannot undo it, which is why it was never a
   * one-click item and is not one here either.
   */
  onRequestLeave: () => void;
}

export function ChannelsV2SettingsTab({
  channel,
  canManage,
  agent,
  onInvite,
  onToggleVisibility,
  onToggleArchive,
  onRequestDelete,
  onRequestLeave,
}: ChannelsV2SettingsTabProps) {
  // A DM is a fixed 1:1 pair — no invite affordance (the server also rejects).
  const canInvite = channel.isMember && !channel.isDirect;
  // A DM is always private (immutable), so it has no visibility toggle.
  const canToggleVisibility = canManage && !channel.isDirect;
  // The non-owner's exit. A DM must NEVER offer "Leave channel": leaving deletes
  // one of the pair's two membership rows, which the server refuses because THAT
  // is what destroys the conversation permanently. Both DM participants get the
  // reversible "Delete conversation" instead.
  const canLeave = channel.isMember && !canManage && !channel.isDirect;
  const canDelete = canManage || (channel.isMember && channel.isDirect);

  const hasActions = canInvite || canToggleVisibility || canManage || canDelete || canLeave;

  if (!agent && !hasActions) {
    return (
      <EmptyState
        icon={Settings2}
        title="Nothing to manage"
        description="Join this channel to change how your agent answers in it."
      />
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto pb-6">
      {agent}

      {hasActions && (
        <>
          <PanelHeading title="Channel" />
          <div className="flex flex-col gap-px px-2">
            {canInvite && (
              <ActionRow icon={UserPlus} label="Add members" onSelect={onInvite} />
            )}
            {canToggleVisibility && (
              <ActionRow
                icon={Hash}
                label={`Make ${channel.visibility === "public" ? "private" : "public"}`}
                onSelect={onToggleVisibility}
              />
            )}
            {canManage && (
              <ActionRow
                icon={channel.archivedAt ? ArchiveRestore : Archive}
                label={channel.archivedAt ? "Unarchive" : "Archive"}
                onSelect={onToggleArchive}
              />
            )}
            {canDelete && (
              <ActionRow
                icon={Trash2}
                label={`Delete ${channel.isDirect ? "conversation" : "channel"}`}
                destructive
                onSelect={onRequestDelete}
              />
            )}
            {canLeave && (
              <ActionRow icon={LogOut} label="Leave channel" onSelect={onRequestLeave} />
            )}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * One action row — the `MetaRow` geometry as a button, so this section and the
 * Info tab beside it read as one column.
 *
 * ⚠ THESE KEEP THEIR GLYPHS while the settings above shed theirs, and the split
 * is the rule, not an oversight: an ACTION row is a verb the reader is scanning
 * for (add / archive / delete / leave), where a glyph is the fastest way in. A
 * SETTING row is a noun with a value beside it, and an icon per row there was
 * exactly the visual noise the inlining ruling removed.
 *
 * `destructive` is INK ONLY: the row opens a confirm dialog, it never performs
 * the write.
 */
function ActionRow({
  icon: Icon,
  label,
  destructive,
  onSelect,
}: {
  icon: LucideIcon;
  label: string;
  destructive?: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "flex h-10 w-full items-center gap-2 rounded-[8px] px-2 text-left text-small transition-colors",
        destructive
          ? "text-danger hover:bg-danger/10"
          : "text-text-secondary hover:bg-surface-raised-1 hover:text-text-primary"
      )}
    >
      <Icon size={14} className="shrink-0" />
      <span className="truncate">{label}</span>
    </button>
  );
}
