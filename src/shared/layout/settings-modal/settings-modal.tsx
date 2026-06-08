"use client";

import { CreditCard, Palette, Settings as SettingsIcon, User, Users } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/shared/ui/dialog";
import { cn } from "@/shared/lib/utils";
import type { Role } from "@/features/workspaces/types";
import { AccountSection } from "./sections/account-section";
import { AppearanceSection } from "./sections/appearance-section";
import { WorkspaceSection } from "./sections/workspace-section";
import { MembersSection } from "./sections/members-section";
import { BillingSection } from "./sections/billing-section";

export type SettingsSection =
  | "account"
  | "appearance"
  | "workspace"
  | "members"
  | "billing";

interface NavItem {
  id: SettingsSection;
  label: string;
  icon: LucideIcon;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const NAV: ReadonlyArray<NavGroup> = [
  {
    label: "Account",
    items: [
      { id: "account", label: "Account", icon: User },
      { id: "appearance", label: "Appearance", icon: Palette },
    ],
  },
  {
    label: "Workspace",
    items: [
      { id: "workspace", label: "General", icon: SettingsIcon },
      { id: "members", label: "Members", icon: Users },
    ],
  },
  {
    label: "Access & billing",
    items: [{ id: "billing", label: "Billing", icon: CreditCard }],
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
 * Notion-style settings modal: grouped left nav + scrolling right pane.
 * Only surfaces sections that have real backing — Account, Workspace
 * (General + image + keys), Members, and Billing.
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex sm:max-w-3xl h-[80vh] p-0 gap-0 bg-modal-surface border-border-strong overflow-hidden">
        <DialogTitle className="sr-only">Settings</DialogTitle>
        <div className="flex h-full w-full">
          <nav className="w-52 shrink-0 border-r border-border-default bg-surface-raised-1 p-3 overflow-y-auto">
            {NAV.map((group) => (
              <div key={group.label} className="mb-4">
                <p className="px-2 mb-1 text-[10px] uppercase tracking-wider text-text-muted">
                  {group.label}
                </p>
                {group.items.map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => onSectionChange(item.id)}
                      className={cn(
                        "w-full flex items-center gap-2.5 px-2 py-1.5 rounded-md text-sm transition-colors cursor-pointer",
                        section === item.id
                          ? "bg-surface-selected text-text-primary"
                          : "text-text-tertiary hover:bg-surface-raised-2 hover:text-text-primary",
                      )}
                    >
                      <Icon size={15} className="shrink-0" />
                      <span>{item.label}</span>
                    </button>
                  );
                })}
              </div>
            ))}
          </nav>

          <div className="flex-1 min-w-0 overflow-y-auto p-6">
            {section === "account" && <AccountSection />}
            {section === "appearance" && <AppearanceSection />}
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
            {section === "billing" && <BillingSection />}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
