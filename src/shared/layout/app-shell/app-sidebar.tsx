"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { SettingsSection } from "@/shared/layout/settings-modal";
import { useConsentInbox } from "@/features/channels/hooks/use-consent-inbox";
import { WorkspaceSwitcher } from "./workspace-switcher";
import { AppSidebarCore, activeSectionFromPath } from "./app-sidebar-core";

export type { NavSection } from "./app-sidebar-core";
export { sectionPath } from "./app-sidebar-core";

interface Props {
  workspaceSegment: string;
  workspaceId: string;
  workspacePublicId: string;
  workspaceName: string;
  onOpenSettings: (section: SettingsSection) => void;
  onCreateWorkspace: () => void;
}

/**
 * App sidebar in the new design language. Brand slot shows the open
 * workspace's name; nav highlights the section the current path is in;
 * footer carries Settings / Help, wired to the settings modal.
 *
 * The markup lives in `./app-sidebar-core`; this file binds it to Next
 * (`next/link`, `usePathname`) and to the consent inbox, so the desktop
 * renderer can mount the same sidebar on the SPA router.
 */
export function AppSidebar({
  workspaceSegment,
  workspaceId,
  workspacePublicId,
  workspaceName,
  onOpenSettings,
  onCreateWorkspace,
}: Props) {
  const pathname = usePathname();
  // Workspace-level pending-consent count so an approval is visible from any
  // page, not just the channels thread. RLS scopes the stream to the caller's
  // own requests; the badge just surfaces "you have something to decide".
  const { requests: consentRequests } = useConsentInbox(workspaceId);

  return (
    <AppSidebarCore
      workspaceSegment={workspaceSegment}
      activeSection={activeSectionFromPath(pathname)}
      consentCount={consentRequests.length}
      onOpenSettings={onOpenSettings}
      Link={Link}
      brand={
        <WorkspaceSwitcher
          workspaceSegment={workspaceSegment}
          workspacePublicId={workspacePublicId}
          workspaceName={workspaceName}
          onOpenSettings={onOpenSettings}
          onCreateWorkspace={onCreateWorkspace}
        />
      }
    />
  );
}
