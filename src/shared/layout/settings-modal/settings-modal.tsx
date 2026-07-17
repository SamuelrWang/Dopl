"use client";

import { cn } from "@/shared/lib/utils";
import type { Role } from "@/features/workspaces/types";
import { AccountSection } from "./sections/account-section";
import { WorkspaceSection } from "./sections/workspace-section";
import { MembersSection } from "./sections/members-section";
import { PlansBilling } from "./sections/plans-billing";
import { ModalShell } from "./modal-shell";
import styles from "./settings-modal.module.css";

export type SettingsSection =
  | "account"
  | "workspace"
  | "members"
  | "billing";

interface NavItem {
  id: SettingsSection;
  label: string;
}

const NAV: ReadonlyArray<{ label: string; items: NavItem[] }> = [
  {
    label: "Workspace",
    items: [
      { id: "workspace", label: "General" },
      { id: "members", label: "Members" },
    ],
  },
  {
    label: "Account",
    items: [
      { id: "account", label: "Account" },
      { id: "billing", label: "Plans & Billing" },
    ],
  },
];

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
  /** Set when opened from a Stripe redirect — Plans & Billing polls the
   *  subscription status until the state settles. "success" (checkout)
   *  celebrates + finalizes; "return" (portal cancel/downgrade) polls
   *  quietly so a stale Pro doesn't linger. */
  billingReturn?: "success" | "return" | null;
}

/**
 * Settings modal in the study-notes popup language: darkened scrim, a
 * floating card, inset left nav with concave-pressed active tabs, and a
 * scrolling right pane. All section content styles with the global
 * tokens + kit classes.
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
    <ModalShell open={open} onClose={() => onOpenChange(false)} label="Settings">
      <nav className={styles.nav}>
        {NAV.map((group) => (
          <div key={group.label} className={styles.navGroup}>
            <p className={styles.navGroupLabel}>{group.label}</p>
            {group.items.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => onSectionChange(item.id)}
                className={cn(
                  styles.navItem,
                  section === item.id && ["concave-sel", styles.navActive]
                )}
              >
                {item.label}
              </button>
            ))}
          </div>
        ))}
        <div className={styles.navFoot}>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="btn-light w-full rounded-md px-2.5 py-1.5 text-small font-medium text-text-primary"
          >
            Close
          </button>
        </div>
      </nav>

      <div className={styles.pane}>
        {section === "account" && <AccountSection />}
        {section === "workspace" && (
          <WorkspaceSection
            workspaceSegment={workspaceSegment}
            onWorkspaceChanged={onWorkspaceChanged}
          />
        )}
        {section === "members" && (
          <MembersSection
            workspaceSegment={workspaceSegment}
            workspaceId={workspaceId}
            currentUserId={currentUserId}
            role={role}
          />
        )}
        {section === "billing" && (
          <PlansBilling
            billingReturn={billingReturn}
            role={role}
            workspaceId={workspaceId}
          />
        )}
      </div>
    </ModalShell>
  );
}
