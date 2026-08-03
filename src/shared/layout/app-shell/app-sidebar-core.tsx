"use client";

import type { ReactNode } from "react";
import {
  BookOpen,
  Hash,
  Home,
  LayoutGrid,
  MessagesSquare,
  Network,
  Settings,
  SlidersHorizontal,
  Sparkles,
  Users,
  Workflow,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import type { LinkLike } from "@/shared/ui/link-like";
// Type-only: erased at compile time, so the Next-coupled settings modal never
// enters the SPA's import graph.
import type { SettingsSection } from "@/shared/layout/settings-modal";
import styles from "./app-shell.module.css";

export type NavSection =
  | "overview"
  | "canvas"
  | "workflows"
  | "knowledge"
  | "skills"
  | "chats"
  | "channels"
  | "ontology"
  | "configuration"
  | "members";

export const NAV: ReadonlyArray<{
  label: string;
  icon: LucideIcon;
  section: NavSection;
}> = [
  { label: "Overview", icon: Home, section: "overview" },
  { label: "Ontology", icon: Network, section: "ontology" },
  { label: "Canvas", icon: LayoutGrid, section: "canvas" },
  { label: "Workflows", icon: Workflow, section: "workflows" },
  { label: "Knowledge", icon: BookOpen, section: "knowledge" },
  { label: "Skills", icon: Sparkles, section: "skills" },
  { label: "Chats", icon: MessagesSquare, section: "chats" },
  { label: "Channels", icon: Hash, section: "channels" },
  { label: "Configuration", icon: SlidersHorizontal, section: "configuration" },
  { label: "Members", icon: Users, section: "members" },
];

export function sectionPath(segment: string, section: NavSection): string {
  return `/${segment}/${section}`;
}

/**
 * Which nav row a path highlights. Path shape: `/{wsSegment}/{section}/...` —
 * the bare workspace root (which redirects to /canvas) highlights Canvas.
 * Both apps derive it from their own router's path, so the rule lives here.
 */
export function activeSectionFromPath(pathname: string): NavSection {
  const segments = pathname.split("/").filter(Boolean);
  return (
    NAV.some((n) => n.section === segments[1]) ? segments[1] : "canvas"
  ) as NavSection;
}

export interface AppSidebarCoreProps {
  workspaceSegment: string;
  /** Highlighted row — `activeSectionFromPath(currentPath)` in both apps. */
  activeSection: NavSection;
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
        <span
          className={styles.navThumb}
          style={{
            transform: `translateY(${
              Math.max(
                0,
                NAV.findIndex((n) => n.section === activeSection)
              ) * 35
            }px)`,
          }}
        />
        {NAV.map(({ label, icon: Icon, section }) => (
          <Link
            key={section}
            href={sectionPath(workspaceSegment, section)}
            className={cn(styles.navItem, section === activeSection && styles.navActive)}
          >
            <Icon size={20} strokeWidth={1.8} />
            {label}
            {section === "channels" && consentCount > 0 && (
              <span className="ml-auto inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full border border-warning/30 bg-warning/10 px-1 text-micro font-semibold text-warning">
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
          className={styles.footItem}
          onClick={() => onOpenSettings("account")}
        >
          <Settings size={20} strokeWidth={1.8} />
          Settings
        </button>
      </div>
    </aside>
  );
}
