"use client";

/**
 * Channels v2 — WHICH MANAGE SURFACE THE SETTINGS TAB HOSTS (Samuel, 2026-08-21).
 *
 * ⚠ THE SETTINGS TAB IS THREAD-SCOPED WHILE A THREAD IS OPEN, the same ruling the
 * Info tab took the day before. Channel view keeps `channel-manage.tsx` verbatim —
 * invite, visibility, archive, delete, leave, the agent settings and the trust
 * roster, all untouched; thread view gets `thread-manage.tsx`, which is the
 * thread's own two controls.
 *
 * ⚠ THIS FILE EXISTS FOR THE MOUNT BOUNDARY, NOT FOR THE TERNARY. Both hosts
 * open READS and WRITE HOOKS on mount — `channel-manage.tsx` alone mounts
 * `useTrustRules` (`/api/channels/trust`), `useChannelPreferenceWrites` and
 * `useChannelLifecycleWrites`, and INVARIANTS §5 pins that none of them fire
 * until the tab is opened. Branching inside either host would run the other's
 * hooks anyway (hooks cannot sit behind an early return), so the choice has to be
 * made by a component that has none of its own. **Keep this file hook-free.**
 *
 * ⚠ IT IS A SLOT, SO `info-panel.tsx` STILL KNOWS NOTHING ABOUT WRITES. That file
 * owns the tab row and takes its bodies as props; this is what the page passes for
 * the Settings body, and the panel renders it only while that tab is open.
 */

import type { Role } from "@/features/workspaces/types";
import { meetsMinRole } from "@/features/workspaces/types";
import type { MutationGate } from "@/shared/hooks/use-api-mutation";
import type { DesktopSessionSummary } from "@/shared/lib/spa-bridge";
import { ChannelsV2ManageActions } from "./channel-manage";
import { ChannelsV2ThreadManageActions } from "./thread-manage";
import type { Channel, ChannelMember, ChannelThread } from "../../types";

export function ChannelsV2SettingsSlot({
  channel,
  workspaceId,
  workspaceSlug,
  currentUserId,
  role,
  members,
  thread,
  agentSessions,
  gate,
  onDeselect,
  onExitThread,
  onRosterChanged,
}: {
  channel: Channel;
  workspaceId: string;
  workspaceSlug: string;
  currentUserId: string;
  role: Role;
  members: ChannelMember[];
  /** The open thread, or `null` for channel view — the whole branch. */
  thread: ChannelThread | null;
  agentSessions: readonly DesktopSessionSummary[] | null;
  gate: MutationGate;
  /** A deleted CHANNEL must not stay selected. */
  onDeselect: () => void;
  /** A deleted THREAD must not stay selected — back to channel view. */
  onExitThread: () => void;
  onRosterChanged: () => void;
}) {
  if (thread) {
    return (
      <ChannelsV2ThreadManageActions
        thread={thread}
        workspaceId={workspaceId}
        currentUserId={currentUserId}
        // ⚠ The SAME pair the server's gate reads (`service-shared.ts ›
        // canManageChannel`): channel owner, or workspace admin. Computed here
        // because this is where both facts are in hand, and mirrored rather than
        // guessed so the row's presence matches the answer the route will give.
        canManageChannel={
          channel.role === "owner" || meetsMinRole(role, "admin")
        }
        agentSessions={agentSessions}
        gate={gate}
        onDeleted={onExitThread}
      />
    );
  }
  return (
    <ChannelsV2ManageActions
      channel={channel}
      workspaceId={workspaceId}
      workspaceSlug={workspaceSlug}
      currentUserId={currentUserId}
      role={role}
      members={members}
      gate={gate}
      onDeselect={onDeselect}
      onRosterChanged={onRosterChanged}
    />
  );
}
