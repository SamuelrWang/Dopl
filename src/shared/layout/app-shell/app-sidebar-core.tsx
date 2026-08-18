"use client";

import type { ReactNode } from "react";
import {
  BookOpen,
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
// ⚠ Type-only import — erased at compile time, so the Next-coupled settings
// modal never enters the SPA's import graph.
import type { SettingsSection } from "@/shared/layout/settings-modal";
import styles from "./app-shell.module.css";

/**
 * ⚠ Adding a section = a member here + a `NAV` row + a route row in
 * `apps/desktop-ui/src/routes.tsx` + the hand copy in
 * `dopl-desktop-app/main/deep-link-target.js`. All four, or it half-lands.
 */
export type NavSection =
  | "overview"
  | "knowledge"
  | "skills"
  | "chats"
  | "channels"
  | "ontology"
  | "members";

export const NAV: ReadonlyArray<{
  label: string;
  icon: LucideIcon;
  section: NavSection;
}> = [
  { label: "Overview", icon: Home, section: "overview" },
  { label: "Ontology", icon: Network, section: "ontology" },
  { label: "Knowledge", icon: BookOpen, section: "knowledge" },
  { label: "Skills", icon: Sparkles, section: "skills" },
  { label: "Chats", icon: MessagesSquare, section: "chats" },
  { label: "Channels", icon: Hash, section: "channels" },
  { label: "Members", icon: Users, section: "members" },
];

export function sectionPath(segment: string, section: NavSection): string {
  return `/${segment}/${section}`;
}

/**
 * Which nav row a path highlights (null = none). Path shape
 * `/{wsSegment}/{section}/...`. Bare workspace root → Overview; a non-nav route
 * like /settings → NOTHING (falling back to the home row made Settings look
 * like it lived under that page). Shared so both routers derive it identically.
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
  /** Pending consents badged on Channels; 0 hides the badge. */
  consentCount: number;
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
  consentCount,
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
              // Kit's ONE nav-chip recipe (globals.css / kit.css); the module
              // contributes column layout only.
              "nav-chip",
              section === activeSection && "nav-chip-active raised-tab"
            )}
          >
            <Icon size={20} strokeWidth={1.8} />
            {label}
            {section === "channels" && consentCount > 0 && (
              <span className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-warning px-1 text-micro font-semibold text-accent-on">
                <span aria-hidden>{consentCount}</span>
                <span className="sr-only">
                  {consentCount === 1
                    ? "1 pending approval"
                    : `${consentCount} pending approvals`}
                </span>
              </span>
            )}
          </Link>
        ))}
      </nav>

      <div className={styles.wordsCard}>
        <div className={styles.wcTitle}>
          <b>Pro</b> unlocks more
        </div>
        <div className={styles.wcDesc}>
          Unlimited knowledge bases, skills, and agent access across your team.
        </div>
        <button
          type="button"
          className={styles.upgradeBtn}
          onClick={() => onOpenSettings("billing")}
        >
          Upgrade to Pro
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
