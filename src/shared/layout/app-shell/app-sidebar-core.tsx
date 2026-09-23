"use client";

import type { ReactNode } from "react";
import {
  BookOpen,
  Bot,
  Hash,
  Home,
  MessagesSquare,
  Network,
  Settings,
  Sparkles,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import type { LinkLike } from "@/shared/ui/link-like";
// Type-only: the Next-coupled settings modal must never enter the SPA's import graph.
import type { SettingsSection } from "@/shared/layout/settings-modal";
import styles from "./app-shell.module.css";

/**
 * Adding a section = a member here + a `NAV` row + a route row in `apps/desktop-ui/src/routes.tsx`
 * + the hand copy in `dopl-desktop-app/main/deep-link-target.js`. All four, or it half-lands.
 */
export type NavSection =
  | "overview"
  | "knowledge"
  | "skills"
  | "chats"
  | "channels"
  | "identities"
  | "ontology"
  | "members";

/**
 * The rendered nav order, channels first (channels is the lead product; Settings is the foot
 * button, not a row). `apps/desktop-ui/src/routes.tsx › WORKSPACE_PAGES` carries the same order by
 * hand: this core is shared with the web tree and cannot import it. Edit both.
 */
export const NAV: ReadonlyArray<{
  label: string;
  icon: LucideIcon;
  section: NavSection;
}> = [
  { label: "Overview", icon: Home, section: "overview" },
  { label: "Channels", icon: Hash, section: "channels" },
  // An identity is a role of the user; "agent" means only a running session (INVARIANTS §5).
  { label: "Identities", icon: Bot, section: "identities" },
  { label: "Knowledge", icon: BookOpen, section: "knowledge" },
  { label: "Skills", icon: Sparkles, section: "skills" },
  { label: "Ontology", icon: Network, section: "ontology" },
  { label: "Chats", icon: MessagesSquare, section: "chats" },
  { label: "Members", icon: Users, section: "members" },
];

export function sectionPath(segment: string, section: NavSection): string {
  return `/${segment}/${section}`;
}

/**
 * Which nav row a path (`/{wsSegment}/{section}/...`) highlights. Bare workspace root → Overview;
 * a non-nav route like /settings → null, so Settings never looks like it lives under a page.
 */
export function activeSectionFromPath(pathname: string): NavSection | null {
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length < 2) return "overview";
  return NAV.some((n) => n.section === segments[1])
    ? (segments[1] as NavSection)
    : null;
}

export interface AppSidebarCoreProps {
  workspaceSegment: string;
  /** `activeSectionFromPath(currentPath)`; null on non-nav routes. */
  activeSection: NavSection | null;
  onOpenSettings: (section: SettingsSection) => void;
  /** Workspace switcher — injected because it routes. */
  brand: ReactNode;
  /** `next/link` on the web, react-router in the SPA. */
  Link: LinkLike;
}

/**
 * Next-free sidebar core (`./app-sidebar` = web binding). Router- and
 * fetch-shaped things are props so the SPA mounts the same sidebar.
 */
export function AppSidebarCore({
  workspaceSegment,
  activeSection,
  onOpenSettings,
  brand,
  Link,
}: AppSidebarCoreProps) {
  return (
    <aside className={styles.sidebar}>
      {brand}

      <nav className={styles.nav}>
        {NAV.map(({ label, icon: Icon, section }) => (
          <Link
            key={section}
            href={sectionPath(workspaceSegment, section)}
            className={cn(
              // The kit's nav-chip recipe; the module contributes column layout only.
              "nav-chip",
              section === activeSection && "nav-chip-active raised-tab"
            )}
          >
            <Icon size={20} strokeWidth={1.8} />
            {label}
          </Link>
        ))}
      </nav>

      {/* Team copy is right: this sidebar mounts only in the workspace shell (/home has none).
          If it ever mounts on a home space, the copy and the billing target must become
          kind-aware. */}
      <div className={styles.wordsCard}>
        <div className={styles.wcTitle}>
          <b>Team</b> unlocks more
        </div>
        <div className={styles.wcDesc}>
          Unlimited knowledge bases, skills, and agent access across your team.
        </div>
        <button
          type="button"
          className={styles.upgradeBtn}
          onClick={() => onOpenSettings("billing")}
        >
          Upgrade to Team
        </button>
      </div>

      <div className={styles.foot}>
        <button
          type="button"
          className="nav-chip"
          onClick={() => onOpenSettings("account")}
        >
          <Settings size={20} strokeWidth={1.8} />
          Settings
        </button>
      </div>
    </aside>
  );
}
