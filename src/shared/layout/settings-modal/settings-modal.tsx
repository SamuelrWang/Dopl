"use client";

import type { Role } from "@/features/workspaces/types";
import { AccountSection } from "./sections/account-section";
// ⚠ `WorkspaceSection` (the General pane) IS NO LONGER MOUNTED HERE — the popup
// lists workspaces now and EDITS none (`./settings-modal-core.tsx ›
// SettingsSection`). The file and its icon uploader are left standing rather
// than deleted, recorded as a finding: the uploader is the tree's only
// workspace-image control and the page that should host it is mid-overhaul.
import { WorkspacesSectionCore } from "./sections/workspaces-section-core";
import { ConnectSectionCore } from "./sections/connect-section-core";
import { PlansBilling } from "./sections/plans-billing";
import { SettingsModalCore, type SettingsSection } from "./settings-modal-core";

export type { SettingsSection };

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  section: SettingsSection;
  onSectionChange: (section: SettingsSection) => void;
  /** ⚠ UNREAD SINCE 2026-09-18 and kept on the shape deliberately: it is what a
   *  General pane needed, and the web's host for that pane is mid-overhaul. */
  workspaceSegment?: string;
  workspaceId: string;
  role: Role;
  /** ⚠ See `workspaceSegment` — no pane in this modal writes a workspace now. */
  onWorkspaceChanged?: () => void;
  /** Set from a Stripe redirect — Plans & Billing polls until state settles.
   *  "success" (checkout) celebrates + finalizes; "return" (portal
   *  cancel/downgrade) polls quietly so a stale Pro doesn't linger. */
  billingReturn?: "success" | "return" | null;
}

/**
 * Settings modal — WEB binding. Chrome and nav live in
 * `./settings-modal-core`; this file supplies the three panes the packaged
 * renderer can't have: multipart icon uploader, Supabase account deletion,
 * Stripe embedded checkout.
 */
export function SettingsModal({
  open,
  onOpenChange,
  section,
  onSectionChange,
  workspaceId,
  role,
  billingReturn = null,
}: Props) {
  return (
    <SettingsModalCore
      open={open}
      onOpenChange={onOpenChange}
      section={section}
      onSectionChange={onSectionChange}
      workspacesPane={<WorkspacesSectionCore activeWorkspaceId={workspaceId} />}
      connectPane={<ConnectSectionCore />}
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
