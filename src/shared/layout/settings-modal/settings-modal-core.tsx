"use client";

import { cn } from "@/shared/lib/utils";
import type { Role } from "@/features/workspaces/types";
import { MembersSection } from "./sections/members-section";
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

export interface SettingsModalCoreProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  section: SettingsSection;
  onSectionChange: (section: SettingsSection) => void;
  workspaceSegment: string;
  workspaceId: string;
  currentUserId: string;
  role: Role;
  /** Workspace > General. Both apps build it from `WorkspaceSectionCore`;
   *  the web adds the multipart icon uploader, which the desktop's
   *  JSON-only IPC bridge cannot carry. */
  workspacePane: React.ReactNode;
  /** Account. Both apps build it from `AccountSectionCore`; the danger
   *  zone differs (web deletes in place, desktop links out). */
  accountPane: React.ReactNode;
  /** Plans & Billing. Stripe Elements on the web; a read-only status pane
   *  plus an open-in-browser handoff in the desktop renderer, whose CSP
   *  refuses the Stripe script and every network origin. */
  billingPane: React.ReactNode;
}

/**
 * Settings modal in the study-notes popup language: darkened scrim, a
 * floating card, a left nav of kit `.nav-chip` rows on the shell's gray
 * surface (the active one raised, identical to the app sidebar), and a
 * scrolling right pane. All section content styles with the global
 * tokens + kit classes.
 *
 * This core is Next-free: the chrome, the section list, and the members
 * pane are identical in both apps, and the three panes whose platform
 * capabilities diverge arrive as slots. `./settings-modal` is the web
 * binding; the desktop renderer's is
 * `apps/desktop-ui/src/components/settings-modal`.
 */
export function SettingsModalCore({
  open,
  onOpenChange,
  section,
  onSectionChange,
  workspaceSegment,
  workspaceId,
  currentUserId,
  role,
  workspacePane,
  accountPane,
  billingPane,
}: SettingsModalCoreProps) {
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
                  // The SAME kit chip the app-shell sidebar renders — one
                  // recipe, two nav rails. `.navGroup` supplies column layout.
                  "nav-chip",
                  section === item.id && "nav-chip-active raised-tab"
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
        {section === "account" && accountPane}
        {section === "workspace" && workspacePane}
        {section === "members" && (
          <MembersSection
            workspaceSegment={workspaceSegment}
            workspaceId={workspaceId}
            currentUserId={currentUserId}
            role={role}
          />
        )}
        {section === "billing" && billingPane}
      </div>
    </ModalShell>
  );
}
