"use client";

import {
  ScopeShareMenu,
  ScopeSharePopover,
} from "@/shared/ui/scope-share-popover";
import { useTeams } from "@/features/members/hooks/use-teams";
import { chatScope, type ChatScope } from "../scope";
import type { Chat } from "../types";

/**
 * Owner-facing chat sharing control — thin wrapper over the shared
 * ScopeSharePopover. Non-owners get a read-only scope pill. A chat
 * filed in a folder inherits the folder's scope, so its pill is locked
 * with an explanation instead of a menu.
 */
export function ShareControl({
  chat,
  folderName,
  workspaceSlug,
  currentUserId,
  isAdmin,
  onShareChange,
}: {
  chat: Chat;
  /** Name of the folder the chat is filed in — locks the control. */
  folderName?: string | null;
  workspaceSlug: string;
  currentUserId: string;
  isAdmin: boolean;
  onShareChange: (scope: ChatScope, teamIds: string[]) => Promise<void>;
}) {
  const scope = chatScope(chat);
  const locked =
    chat.folderId !== null && folderName
      ? {
          title: `Sharing follows the folder "${folderName}"`,
          note: (
            <p className="text-caption leading-relaxed text-text-secondary">
              This chat is in the folder{" "}
              <span className="font-semibold text-text-primary">
                {folderName}
              </span>{" "}
              and inherits its sharing. Change the folder&apos;s sharing (from
              the chat list), or unfile the chat to share it on its own.
            </p>
          ),
        }
      : undefined;

  return (
    <ScopeSharePopover
      scope={scope}
      readOnly={chat.owner.userId !== currentUserId}
      triggerTitle="Change who can read this chat"
      locked={locked}
    >
      {(close) => (
        <ShareMenu
          scope={scope}
          grantedTeamIds={chat.grantedTeamIds}
          workspaceSlug={workspaceSlug}
          currentUserId={currentUserId}
          isAdmin={isAdmin}
          onApply={async (nextScope, teamIds) => {
            await onShareChange(nextScope, teamIds);
            close();
          }}
        />
      )}
    </ScopeSharePopover>
  );
}

/**
 * Chat scope picker — supplies the teams fetch to the shared menu.
 * Also used by the folder share control (folders pass `warning` to
 * flag that the scope propagates to every chat inside).
 */
export function ShareMenu({
  scope,
  grantedTeamIds,
  workspaceSlug,
  currentUserId,
  isAdmin,
  warning,
  onApply,
}: {
  scope: ChatScope;
  grantedTeamIds: string[];
  workspaceSlug: string;
  currentUserId: string;
  isAdmin: boolean;
  warning?: string;
  onApply: (scope: ChatScope, teamIds: string[]) => Promise<void>;
}) {
  const teamsState = useTeams(workspaceSlug);
  return (
    <ScopeShareMenu
      scope={scope}
      grantedTeamIds={grantedTeamIds}
      currentUserId={currentUserId}
      isAdmin={isAdmin}
      teams={teamsState}
      warning={warning}
      onApply={onApply}
    />
  );
}
