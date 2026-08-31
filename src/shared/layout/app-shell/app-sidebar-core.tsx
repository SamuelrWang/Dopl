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
  | "agents"
  | "ontology"
  | "members";

/**
 * THE RENDERED NAV ORDER — CHANNELS-FIRST (Samuel's ruling, 2026-08-30; ledger
 * ASK-6). Overview, Channels, Agents, Knowledge, Skills, Ontology, Chats,
 * Members — then Settings, which is the foot button below and not a row here.
 *
 * ⚠ IT IS A PRODUCT STATEMENT, NOT A TIDY-UP. Channels is the lead product
 * (2026-08-03 pivot) and ontology is substrate; the shipped rail said the
 * opposite — ontology second, channels sixth — because nothing had ever
 * reordered it. No doc recorded a demotion, so this line is the record.
 *
 * ⚠ `apps/desktop-ui/src/routes.tsx › WORKSPACE_PAGES` CARRIES THE SAME ORDER
 * BY HAND and must be edited with this list. That table cannot be imported here
 * (this core is shared with the web tree, which does not build the SPA), and
 * the SPA cannot own the order either, because this file is what draws the rail.
 */
export const NAV: ReadonlyArray<{
  label: string;
  icon: LucideIcon;
  section: NavSection;
}> = [
  { label: "Overview", icon: Home, section: "overview" },
  { label: "Channels", icon: Hash, section: "channels" },
  // AGENT TEMPLATES (2026-08-22). ⚠ The label is "Agents" and the path segment
  // is `agents`, NOT `agent-templates`: the operator's noun for the thing they
  // author here is the agent (INVARIANTS §5 — the noun on every agent surface is
  // AGENT, and a qualifier is a copy regression, not a style preference).
  { label: "Agents", icon: Bot, section: "agents" },
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
  // ⚠ `consentCount` STOOD HERE AND IS DELETED (Samuel, 2026-08-25). It badged
  // the Channels row with the drafts this operator's agent was holding, and it
  // pointed at the consent Inbox — a pane that no longer exists. The outbound
  // review is the work stream's own card (`agent-stream.tsx ›
  // SentToChannelBox`); a badge in the app nav would be a claim about a
  // destination there is no longer any way to reach.
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
              // Kit's ONE nav-chip recipe (globals.css / kit.css); the module
              // contributes column layout only.
              "nav-chip",
              section === activeSection && "nav-chip-active raised-tab"
            )}
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
