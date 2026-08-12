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
// Type-only: erased at compile time, so the Next-coupled settings modal never
// enters the SPA's import graph.
import type { SettingsSection } from "@/shared/layout/settings-modal";
import styles from "./app-shell.module.css";

/**
 * RETIRED (2026-08-07), then DELETED (2026-08-11): `canvas`, `workflows` and
 * `configuration` are gone from this union, from `NAV`, and from the tree — no
 * page remains behind any of the three names. Adding a section back means a
 * route row in `apps/desktop-ui/src/routes.tsx` AND the hand copy in
 * `dopl-desktop-app/main/deep-link-target.js`.
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
 * Which nav row a path highlights (null = none). Path shape:
 * `/{wsSegment}/{section}/...` — the bare workspace root (which redirects
 * to /overview, `WORKSPACE_HOME_PATH`) highlights Overview; a non-nav route
 * like /settings highlights NOTHING (falling back to the home row made
 * Settings look like it lived under that page). Both apps derive it from
 * their own router's path, so the rule lives here.
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
  /** Highlighted row — `activeSectionFromPath(currentPath)` in both apps.
   *  Null on non-nav routes (e.g. /settings): no row highlights. */
  activeSection: NavSection | null;
  /** Pending consent requests badged on Channels; 0 hides the badge. */
  consentCount: number;
  onOpenSettings: (section: SettingsSection) => void;
  /** The brand slot — the workspace switcher, injected because it routes. */
  brand: ReactNode;
  /** Router-agnostic link — `next/link` in the web app, react-router in the SPA. */
  Link: LinkLike;
}

/**
 * The sidebar's Next-free core (see `./app-sidebar` for the web binding):
 * brand slot, section nav with the sliding thumb, upgrade card, footer.
 * Everything router- or fetch-shaped is a prop so the desktop renderer can
 * mount the same sidebar on the SPA router.
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
              // The kit's ONE nav-chip recipe (globals.css / kit.css); the
              // module contributes column layout only. Active chip = darker
              // ink + the kit's raised white face over the chip's radius.
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
