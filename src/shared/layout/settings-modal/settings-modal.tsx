"use client";

import type { Role } from "@/features/workspaces/types";
import { AccountSection } from "./sections/account-section";
import { WorkspaceSection } from "./sections/workspace-section";
import { PlansBilling } from "./sections/plans-billing";
import { SettingsModalCore, type SettingsSection } from "./settings-modal-core";

export type { SettingsSection };

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  section: SettingsSection;
  onSectionChange: (section: SettingsSection) => void;
  workspaceSegment: string;
  workspaceId: string;
  currentUserId: string;
  role: Role;
  onWorkspaceChanged: () => void;
  /** Set from a Stripe redirect — Plans & Billing polls until state settles.
   *  "success" (checkout) celebrates + finalizes; "return" (portal
   *  cancel/downgrade) polls quietly so a stale Pro doesn't linger. */
  billingReturn?: "success" | "return" | null;
}

/**
 * Settings modal — WEB binding. Chrome/nav/members live in
 * `./settings-modal-core`; this file supplies the three panes the packaged
 * renderer can't have: multipart icon uploader, Supabase account deletion,
 * Stripe embedded checkout.
 */
export function SettingsModal({
  open,
  onOpenChange,
  section,
  onSectionChange,
  workspaceSegment,
  workspaceId,
  currentUserId,
  role,
  onWorkspaceChanged,
  billingReturn = null,
}: Props) {
  return (
    <SettingsModalCore
      open={open}
      onOpenChange={onOpenChange}
      section={section}
      onSectionChange={onSectionChange}
      workspaceSegment={workspaceSegment}
      workspaceId={workspaceId}
      currentUserId={currentUserId}
      role={role}
      workspacePane={
        <WorkspaceSection
          workspaceSegment={workspaceSegment}
          onWorkspaceChanged={onWorkspaceChanged}
        />
      }
      accountPane={<AccountSection />}
      billingPane={
        <PlansBilling
          billingReturn={billingReturn}
          role={role}
          workspaceId={workspaceId}
        />
      }
    />
  );
}
