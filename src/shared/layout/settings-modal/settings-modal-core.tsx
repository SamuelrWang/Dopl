"use client";

import { Bot, CreditCard, LayoutGrid, Plug, UserRound } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/shared/lib/utils";
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
 * ⚠ **`"agents"` IS THE ONE OPTIONAL MEMBER** — DEFAULT AGENT SETTINGS, desktop
 * only, drawn only when `agentsPane` is passed (see the prop, and `has` below).
 */
export type SettingsSection =
  | "workspaces"
  | "connect"
  | "agents"
  | "account"
  | "billing";

interface NavItem {
  id: SettingsSection;
  label: string;
  icon: LucideIcon;
}

/**
 * ONE FLAT LIST, NO GROUP HEADERS (Samuel, 2026-09-18: *"kill the indented
 * sidebar"*, *"remove the Account/Workspace headers"*).
 *
 * ⚠ The uppercase "WORKSPACE" / "ACCOUNT" strips and the `.navGroup` column they
 * titled are DELETED, not hidden: they were the only thing indenting this rail,
 * and a header over a single row was naming a group of one.
 *
 * ⚠ **"Agents" SITS BELOW Connect** (Samuel, same review) and is the one row
 * that may be ABSENT — `has` below is what drops it, so the WEB draws four rows
 * and the DESKTOP five. It is not reordered by that: the list is the order,
 * filtered, never two lists.
 */
const NAV: ReadonlyArray<NavItem> = [
  { id: "workspaces", label: "Workspaces", icon: LayoutGrid },
  { id: "connect", label: "Connect", icon: Plug },
  { id: "agents", label: "Agents", icon: Bot },
  { id: "account", label: "Account", icon: UserRound },
  { id: "billing", label: "Plans & Billing", icon: CreditCard },
];

export interface SettingsModalCoreProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  section: SettingsSection;
  onSectionChange: (section: SettingsSection) => void;
  /** Every container this account belongs to, home space included. */
  workspacesPane: React.ReactNode;
  /** The MCP "Connect & log in" block + the account's live grants. */
  connectPane: React.ReactNode;
  /** From `AccountSectionCore` in both apps; danger zone differs (web deletes
   *  in place, desktop links out). */
  accountPane: React.ReactNode;
  /** Stripe Elements on the web; read-only status + open-in-browser handoff on
   *  desktop, whose CSP refuses the Stripe script and every network origin. */
  billingPane: React.ReactNode;
  /**
   * DEFAULT AGENT SETTINGS (2026-09-18) — the one pane that is OPTIONAL, and the omission is the
   * contract rather than a convenience. The record it edits lives in the desktop's own local
   * store, so the WEB binding passes nothing and the nav entry is not drawn at all: the
   * no-dead-rows rule (INVARIANTS §5), and the strong version of it here, since a tab that
   * persisted nothing would promise new channels inherit settings that cannot exist.
   */
  agentsPane?: React.ReactNode;
}

/**
 * Next-free settings-modal core: chrome and section list are shared; the
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
  workspacesPane,
  connectPane,
  accountPane,
  billingPane,
  agentsPane,
}: SettingsModalCoreProps) {
  // ⚠ ONE PREDICATE, READ BY BOTH THE RAIL AND THE PANE. A nav entry whose pane is absent is a
  // row that selects nothing, and a pane rendered under no entry is unreachable — so which
  // sections EXIST is decided once, here, rather than by two conditions that can disagree.
  const has = (id: SettingsSection) => id !== "agents" || agentsPane != null;
  return (
    <ModalShell open={open} onClose={() => onOpenChange(false)} label="Settings">
      <nav className={styles.nav}>
        {/* ⚠ THE APP SIDEBAR'S ROW, NOT A LOOKALIKE — same `nav-chip` recipe,
            same `--shell-chip` resting gray, same 20px lucide glyph at the same
            stroke (`app-shell/app-sidebar-core.tsx`), Agents wearing that rail's
            own `Bot`. The two rails read one declaration, so neither can drift
            to a second gray. */}
        <div className={styles.navList}>
          {NAV.filter(({ id }) => has(id)).map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => onSectionChange(id)}
              className={cn(
                "nav-chip",
                section === id && "nav-chip-active raised-tab"
              )}
            >
              <Icon size={20} strokeWidth={1.8} />
              {label}
            </button>
          ))}
        </div>
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
        {section === "connect" && connectPane}
        {section === "account" && accountPane}
        {section === "billing" && billingPane}
        {section === "agents" && has("agents") && agentsPane}
      </div>
    </ModalShell>
  );
}
