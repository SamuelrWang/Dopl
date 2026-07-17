"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BookOpen,
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
import type { SettingsSection } from "@/shared/layout/settings-modal";
import { WorkspaceSwitcher } from "./workspace-switcher";
import styles from "./app-shell.module.css";

type NavSection =
  | "overview"
  | "canvas"
  | "workflows"
  | "knowledge"
  | "skills"
  | "chats"
  | "ontology"
  | "configuration"
  | "members";

const NAV: ReadonlyArray<{ label: string; icon: LucideIcon; section: NavSection }> = [
  { label: "Overview", icon: Home, section: "overview" },
  { label: "Canvas", icon: LayoutGrid, section: "canvas" },
  { label: "Workflows", icon: Workflow, section: "workflows" },
  { label: "Knowledge", icon: BookOpen, section: "knowledge" },
  { label: "Skills", icon: Sparkles, section: "skills" },
  { label: "Chats", icon: MessagesSquare, section: "chats" },
  { label: "Ontology", icon: Network, section: "ontology" },
  { label: "Configuration", icon: SlidersHorizontal, section: "configuration" },
  { label: "Members", icon: Users, section: "members" },
];

interface Props {
  workspaceSegment: string;
  workspacePublicId: string;
  workspaceName: string;
  onOpenSettings: (section: SettingsSection) => void;
  onCreateWorkspace: () => void;
}

function sectionPath(segment: string, section: NavSection): string {
  return `/${segment}/${section}`;
}

/**
 * App sidebar in the new design language. Brand slot shows the open
 * workspace's name; nav highlights the section the current path is in;
 * footer carries Settings / Help, wired to the settings modal.
 */
export function AppSidebar({
  workspaceSegment,
  workspacePublicId,
  workspaceName,
  onOpenSettings,
  onCreateWorkspace,
}: Props) {
  const pathname = usePathname();
  // Path shape: /{wsSegment}/{section}/... — the bare workspace root
  // (which redirects to /canvas) highlights Canvas.
  const segments = pathname.split("/").filter(Boolean);
  const activeSection: NavSection = (
    NAV.some((n) => n.section === segments[1]) ? segments[1] : "canvas"
  ) as NavSection;

  return (
    <aside className={styles.sidebar}>
      <WorkspaceSwitcher
        workspaceSegment={workspaceSegment}
        workspacePublicId={workspacePublicId}
        workspaceName={workspaceName}
        onOpenSettings={onOpenSettings}
        onCreateWorkspace={onCreateWorkspace}
      />

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
