"use client";

import { SegmentedControl, type SegmentedOption } from "@/shared/ui/segmented-control";
import { SMALL_TEXT_BUTTON } from "@/shared/ui/small-action-button";
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
 *
 * ⚠ **`"workspace"` (General) IS GONE AND `"workspaces"` IS NOT ITS RENAME
 * (Samuel, 2026-09-18 — the R-10 overhaul).** General was THIS workspace's
 * rename/description/danger form; Workspaces is a LIST of every container the
 * account belongs to, home space included. The form itself is untouched and
 * still lives on `/{segment}/settings`
 * (`sections/workspace-section-core.tsx › WorkspaceSectionBody`), which is the
 * one surface that edits a workspace now.
 *
 * ⚠ **`"connect"` IS DELETED, NOT RENAMED (Samuel, 2026-10-02).** Its two panels
 * split into their own tabs: `"agents"` (connected agent apps + sign-in + how to
 * connect one) and `"devices"` (computers + glasses). The default agent settings
 * that `"agents"` used to hold moved to `"configuration"`.
 *
 * ⚠ **`"configuration"` AND `"notifications"` ARE THE OPTIONAL MEMBERS** — both
 * desktop only (default agent settings; which events raise a banner), each drawn only
 * when its pane is passed (see the props, and `has` below).
 */
export type SettingsSection =
  | "workspaces"
  | "agents"
  | "devices"
  | "configuration"
  | "notifications"
  | "account"
  | "billing";

/** One flat list, in order; `has` drops the optional rows, so the web draws five and the desktop
 *  seven. */
const NAV: ReadonlyArray<SegmentedOption<SettingsSection>> = [
  { key: "workspaces", label: "Workspaces" },
  { key: "agents", label: "Agents" },
  { key: "devices", label: "Devices" },
  { key: "configuration", label: "Configuration" },
  { key: "notifications", label: "Notifications" },
  { key: "account", label: "Account" },
  { key: "billing", label: "Plans & Billing" },
];

export interface SettingsModalCoreProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  section: SettingsSection;
  onSectionChange: (section: SettingsSection) => void;
  /** Every container this account belongs to, home space included. */
  workspacesPane: React.ReactNode;
  /** Connected agent apps, runtime sign-in, and how to connect one. */
  agentsPane: React.ReactNode;
  /** Computers and glasses connected to the caller's agents. */
  devicesPane: React.ReactNode;
  /** From `AccountSectionCore` in both apps; danger zone differs (web deletes
   *  in place, desktop links out). */
  accountPane: React.ReactNode;
  /** Stripe Elements on the web; read-only status + open-in-browser handoff on
   *  desktop, whose CSP refuses the Stripe script and every network origin. */
  billingPane: React.ReactNode;
  /**
   * CONFIGURATION — DEFAULT AGENT SETTINGS (2026-09-18; its own tab since 2026-10-02) — the one
   * pane that is OPTIONAL, and the omission is the
   * contract rather than a convenience. The record it edits lives in the desktop's own local
   * store, so the WEB binding passes nothing and the nav entry is not drawn at all: the
   * no-dead-rows rule (INVARIANTS §5), and the strong version of it here, since a tab that
   * persisted nothing would promise new channels inherit settings that cannot exist.
   */
  configurationPane?: React.ReactNode;
  /**
   * NOTIFICATIONS (2026-10-09) — which events raise a banner. OPTIONAL on the configuration
   * pane's terms: v1 stores the record on this Mac (the banners are the desktop's), so the web
   * passes nothing and draws no row. When the server table lands the web can pass one too.
   */
  notificationsPane?: React.ReactNode;
}

/**
 * Next-free settings-modal core: chrome and section list are shared; the
 * platform-divergent panes arrive as slots. The one binding is desktop's,
 * `apps/desktop-ui/src/components/settings-modal`; the web binding
 * (`./settings-modal`) was never mounted and was deleted 2026-10-11 (cleanup ST1).
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
  workspacesPane,
  agentsPane,
  devicesPane,
  configurationPane,
  notificationsPane,
  accountPane,
  billingPane,
}: SettingsModalCoreProps) {
  // ⚠ ONE PREDICATE, READ BY BOTH THE RAIL AND THE PANE. A nav entry whose pane is absent is a
  // row that selects nothing, and a pane rendered under no entry is unreachable — so which
  // sections EXIST is decided once, here, rather than by two conditions that can disagree.
  const has = (id: SettingsSection) =>
    (id !== "configuration" || configurationPane != null) &&
    (id !== "notifications" || notificationsPane != null);
  return (
    <ModalShell open={open} onClose={() => onOpenChange(false)} label="Settings">
      <nav className={styles.nav}>
        {/* /home's header tabs, stacked: words only, the selected one underlined. */}
        <SegmentedControl<SettingsSection>
          options={NAV.filter(({ key }) => has(key))}
          value={section}
          onChange={onSectionChange}
          variant="underline"
          size="lg"
          orientation="vertical"
          ariaLabel="Settings sections"
        />
        <div className={styles.navFoot}>
          {/* The popup kit's flat text button (`shared/ui/form-dialog.tsx` ›
              Discard), so this footer and every New-agent-style popup footer
              are one declaration. */}
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className={SMALL_TEXT_BUTTON}
          >
            Close
          </button>
        </div>
      </nav>

      <div className={styles.pane}>
        {section === "workspaces" && workspacesPane}
        {section === "agents" && agentsPane}
        {section === "devices" && devicesPane}
        {section === "configuration" && has("configuration") && configurationPane}
        {section === "notifications" && has("notifications") && notificationsPane}
        {section === "account" && accountPane}
        {section === "billing" && billingPane}
      </div>
    </ModalShell>
  );
}
