"use client";

import {
  CreditCard,
  Settings as SettingsIcon,
  User,
  Users,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
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
  icon: LucideIcon;
}

const NAV: ReadonlyArray<{ label: string; items: NavItem[] }> = [
  {
    label: "Workspace",
    items: [
      { id: "workspace", label: "General", icon: SettingsIcon },
      { id: "members", label: "Members", icon: Users },
    ],
  },
  {
    label: "Account",
    items: [
      { id: "account", label: "Account", icon: User },
      { id: "billing", label: "Plans & Billing", icon: CreditCard },
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
}

/**
 * Settings modal in the new design language: a darkened scrim with a
 * scaled-down "page" card that fades / pops in. Grouped left nav +
 * scrolling right pane. The Account / Appearance / General / Members
 * sections are reused as-is (rendered light via the module's token scope);
 * Plans & Billing is the new cloned billing layout.
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
}: Props) {
  return (
    <ModalShell open={open} onClose={() => onOpenChange(false)} label="Settings">
      <button
        type="button"
        className={styles.close}
        onClick={() => onOpenChange(false)}
        aria-label="Close settings"
      >
        <X size={18} />
      </button>

      <nav className={styles.nav}>
        {NAV.map((group) => (
          <div key={group.label} className={styles.navGroup}>
            <p className={styles.navGroupLabel}>{group.label}</p>
            {group.items.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onSectionChange(item.id)}
                  className={cn(styles.navItem, section === item.id && styles.navActive)}
                >
                  <Icon size={18} strokeWidth={1.8} />
                  {item.label}
                </button>
              );
            })}
          </div>
        ))}
        <div className={styles.navFoot}>Dopl</div>
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
        {section === "billing" && <PlansBilling />}
      </div>
    </ModalShell>
  );
}

