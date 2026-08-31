"use client";

import { cn } from "@/shared/lib/utils";
import { ModalShell } from "./modal-shell";
import styles from "./settings-modal.module.css";

/**
 * ⚠ NO `"members"` MEMBER, AND THAT IS A RULING (Samuel, 2026-08-30 — ledger
 * ASK-1, option b+). The modal's members pane and the whole v1 members console
 * it mounted (`members-tab.tsx`, `member-row.tsx`, `members-skeleton.tsx`,
 * `pending-invitations.tsx`, `join-requests-banner.tsx`) are DELETED, not
 * repointed at v2: `/members` is the one members console. Both v1 bugs died
 * with it — the failed-roster-read-as-"No members yet." fall-through (ledger D8)
 * and the ghost/real grid mismatch (P10). **Do not re-add a row here**; a nav
 * entry that opens a second console is how the two drifted apart in the first
 * place.
 */
export type SettingsSection = "account" | "workspace" | "billing";

interface NavItem {
  id: SettingsSection;
  label: string;
}

const NAV: ReadonlyArray<{ label: string; items: NavItem[] }> = [
  {
    label: "Workspace",
    items: [{ id: "workspace", label: "General" }],
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
  /** From `WorkspaceSectionCore` in both apps; web adds the multipart icon
   *  uploader, which the desktop's JSON-only IPC bridge cannot carry. */
  workspacePane: React.ReactNode;
  /** From `AccountSectionCore` in both apps; danger zone differs (web deletes
   *  in place, desktop links out). */
  accountPane: React.ReactNode;
  /** Stripe Elements on the web; read-only status + open-in-browser handoff on
   *  desktop, whose CSP refuses the Stripe script and every network origin. */
  billingPane: React.ReactNode;
}

/**
 * Next-free settings-modal core: chrome and section list are shared; the three
 * platform-divergent panes arrive as slots. `./settings-modal` = web binding,
 * desktop's is `apps/desktop-ui/src/components/settings-modal`.
 *
 * ⚠ IT OWNS NO PANE OF ITS OWN SINCE 2026-08-30. The members pane was the one
 * exception and it is deleted (see `SettingsSection`), which is why this
 * component no longer takes `workspaceSegment` / `workspaceId` /
 * `currentUserId` / `role` — nothing here reads a workspace fact any more.
 */
export function SettingsModalCore({
  open,
  onOpenChange,
  section,
  onSectionChange,
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
                  // SAME kit chip as the app-shell sidebar — one recipe, two
                  // nav rails. `.navGroup` supplies column layout.
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
        {section === "billing" && billingPane}
      </div>
    </ModalShell>
  );
}
