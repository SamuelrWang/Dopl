"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  BookOpen,
  ChevronDown,
  ChevronRight,
  Home,
  LayoutGrid,
  MessageSquare,
  Plus,
  Search,
  Settings,
  Sparkles,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { RESERVED_WORKSPACE_SLUGS } from "@/config";
import { useSkills } from "@/features/skills/client/hooks";
import {
  createSkill as apiCreateSkill,
} from "@/features/skills/client/api";
import { useSkillsRealtime } from "@/features/skills/client/realtime";
import { useKnowledgeBases } from "@/features/knowledge/client/hooks";
import {
  createBase as apiCreateBase,
  createEntry as apiCreateEntry,
} from "@/features/knowledge/client/api";
import { useKnowledgeRealtime } from "@/features/knowledge/client/realtime";
import { toast } from "@/shared/ui/toast";
import { UserMenu } from "./user-menu";

/**
 * Default body seeded into the first entry of every KB created from
 * the sidebar "+ New knowledge base" affordance. Nudges the user
 * toward connecting an agent and tells them where to find the
 * agent-write toggle.
 */
const DEFAULT_KB_README_BODY = `# Welcome to your knowledge base

This is your first entry. You can edit it directly here, or connect your agent to read, edit, and create entries automatically.

To enable agent edits, open this knowledge base's settings and turn on **Agent: write** for the base.
`;

/**
 * Default body for the SKILL.md of every skill created from the
 * sidebar. Mirrors the KB README in tone — point the user at the
 * agent-edit pathway from the start.
 */
const DEFAULT_SKILL_BODY = `# When to use this skill

Describe the situations where the agent should invoke this skill.

## Procedure

Step-by-step instructions for the agent. You can edit this directly here, or connect your agent to refine it as you work together.
`;

interface WorkspaceLike {
  id: string;
  name: string;
  slug: string;
}

interface PendingInvitation {
  token: string;
  invitedRole: string;
  workspaceId: string;
  workspaceSlug: string;
  workspaceName: string;
  createdAt: string;
}

type NavSection =
  | "overview"
  | "canvas"
  | "chat"
  | "knowledge"
  | "skills"
  | "activity"
  | "members"
  | "settings";

interface NavItem {
  label: string;
  icon: LucideIcon;
  section: NavSection;
}

const navItems: ReadonlyArray<NavItem> = [
  { label: "Overview", icon: Home, section: "overview" },
  { label: "Canvas", icon: LayoutGrid, section: "canvas" },
  { label: "Chat", icon: MessageSquare, section: "chat" },
  { label: "Knowledge", icon: BookOpen, section: "knowledge" },
  { label: "Skills", icon: Sparkles, section: "skills" },
  { label: "Activity", icon: Activity, section: "activity" },
  { label: "Members", icon: Users, section: "members" },
  { label: "Settings", icon: Settings, section: "settings" },
];

/** Static workspace sub-routes — anything matching `/{ws}/<one of these>`
 * is a named sub-page, not a canvas slug. Used by `isCanvasPath` to
 * keep the Canvas nav item from claiming the active state on these. */
const NAMED_WORKSPACE_SUBROUTES: ReadonlyArray<string> = [
  "overview",
  "chat",
  "knowledge",
  "skills",
  "activity",
  "settings",
];

/**
 * Pull the workspace slug out of a pathname like `/{wsSlug}/main` or
 * `/{wsSlug}/knowledge`. Returns null for top-level static routes
 * (`/login`, `/settings`, ...) and the legacy `/canvas` redirect, since
 * neither has a workspace context yet.
 */
function workspaceSlugFromPath(pathname: string): string | null {
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length === 0) return null;
  const first = segments[0];
  if (RESERVED_WORKSPACE_SLUGS.has(first)) return null;
  return first;
}

function isCanvasPath(pathname: string): boolean {
  if (pathname === "/canvas" || pathname.startsWith("/canvas/")) return true;
  const segments = pathname.split("/").filter(Boolean);
  // /{wsSlug}/{canvasSlug} when the first segment is a workspace slug
  // (i.e. not reserved) and the second segment isn't one of the named
  // workspace sub-routes.
  if (segments.length < 2) return false;
  if (RESERVED_WORKSPACE_SLUGS.has(segments[0])) return false;
  return !NAMED_WORKSPACE_SUBROUTES.includes(segments[1]);
}

function sectionPathFor(slug: string, section: NavSection): string {
  if (section === "canvas") return `/${slug}`;
  return `/${slug}/${section}`;
}

export function Sidebar() {
  const pathname = usePathname();
  const slug = workspaceSlugFromPath(pathname);
  const { workspaces, currentWorkspace, refresh: refreshWorkspaces } =
    useWorkspaces(slug);
  const { invitations, refresh: refreshInvitations } =
    usePendingInvitations();
  const fallbackName = currentWorkspace?.name ?? "Workspace";

  return (
    <aside
      className="hidden md:flex fixed inset-y-0 left-0 w-64 z-10 flex-col overflow-hidden border-r border-white/[0.06] pointer-events-auto"
      style={{ backgroundColor: "oklch(0.13 0 0)" }}
    >
      <SidebarHeader
        currentSlug={currentWorkspace?.slug ?? slug ?? "default"}
        currentName={fallbackName}
        workspaces={workspaces}
        invitations={invitations}
        onAccepted={() => {
          refreshInvitations();
          refreshWorkspaces();
        }}
      />
      <SidebarSearchRow />
      {/* Nav region claims the remaining height and scrolls internally
          when the list of expanded KBs / skills overflows. min-h-0 is
          required for overflow-y to work inside a flex column. */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        <SidebarNav
          pathname={pathname}
          workspaceSlug={currentWorkspace?.slug ?? slug}
          workspaceId={currentWorkspace?.id ?? null}
        />
      </div>
      <div className="px-3 py-3 border-t border-white/[0.06]">
        <UserMenu dropdownDirection="up" />
      </div>
    </aside>
  );
}

function useWorkspaces(activeSlug: string | null) {
  const [workspaces, setWorkspaces] = useState<WorkspaceLike[] | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/workspaces")
      .then((r) => (r.ok ? r.json() : { workspaces: [] }))
      .then((body: { workspaces?: WorkspaceLike[] }) => {
        if (!cancelled) setWorkspaces(body.workspaces ?? []);
      })
      .catch(() => {
        if (!cancelled) setWorkspaces([]);
      });
    return () => {
      cancelled = true;
    };
  }, [tick]);

  const refresh = useCallback(() => setTick((t) => t + 1), []);

  const currentWorkspace = useMemo(() => {
    if (!workspaces || workspaces.length === 0) return null;
    if (activeSlug) {
      const match = workspaces.find((w) => w.slug === activeSlug);
      if (match) return match;
    }
    return workspaces[0];
  }, [workspaces, activeSlug]);

  return { workspaces: workspaces ?? [], currentWorkspace, refresh };
}

function usePendingInvitations() {
  const [invitations, setInvitations] = useState<PendingInvitation[]>([]);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/invitations/pending")
      .then((r) => (r.ok ? r.json() : { invitations: [] }))
      .then((body: { invitations?: PendingInvitation[] }) => {
        if (!cancelled) setInvitations(body.invitations ?? []);
      })
      .catch(() => {
        if (!cancelled) setInvitations([]);
      });
    return () => {
      cancelled = true;
    };
  }, [tick]);

  const refresh = useCallback(() => setTick((t) => t + 1), []);
  return { invitations, refresh };
}

interface SidebarHeaderProps {
  currentSlug: string;
  currentName: string;
  workspaces: WorkspaceLike[];
  invitations: PendingInvitation[];
  onAccepted: () => void;
}

function SidebarHeader({
  currentSlug,
  currentName,
  workspaces,
  invitations,
  onAccepted,
}: SidebarHeaderProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [acceptingToken, setAcceptingToken] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const hasInvites = invitations.length > 0;

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  async function handleAccept(invite: PendingInvitation) {
    if (acceptingToken) return;
    setAcceptingToken(invite.token);
    try {
      const res = await fetch(
        `/api/workspaces/invitations/${encodeURIComponent(invite.token)}/accept`,
        { method: "POST" },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(
          body?.error?.message || body?.error || "Couldn't accept",
        );
      }
      onAccepted();
      setOpen(false);
      router.push(`/${invite.workspaceSlug}`);
      router.refresh();
    } catch {
      // Refresh anyway — invite may have been revoked / expired since
      // last poll. The list will reconcile.
      onAccepted();
    } finally {
      setAcceptingToken(null);
    }
  }

  return (
    <div
      ref={ref}
      className="relative flex items-center gap-2 px-3 py-3 border-b border-white/[0.06]"
    >
      <Link
        href={`/${currentSlug}`}
        aria-label="Dopl"
        className="shrink-0 flex items-center justify-center w-7 h-7 rounded-md overflow-hidden"
      >
        <Image
          src="/favicons/favicon-32x32.png"
          alt="Dopl"
          width={20}
          height={20}
          className="rounded-sm"
        />
      </Link>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="relative flex-1 flex items-center justify-between gap-2 px-2 py-1 rounded-md hover:bg-white/[0.04] transition-colors text-left cursor-pointer"
      >
        <span className="text-sm font-medium text-text-primary truncate">
          {currentName}
        </span>
        <span className="flex items-center gap-1.5 shrink-0">
          {hasInvites && (
            <span
              aria-label={`${invitations.length} pending invitation${invitations.length === 1 ? "" : "s"}`}
              className="w-1.5 h-1.5 rounded-full bg-red-500"
            />
          )}
          <ChevronDown size={14} className="text-text-secondary/60" />
        </span>
      </button>

      {open && (
        <div
          className="absolute left-3 right-3 top-full mt-1 rounded-md overflow-hidden bg-[oklch(0.16_0_0)] border border-white/[0.1] shadow-[0_8px_32px_rgba(0,0,0,0.5)] z-10"
        >
          {workspaces.length === 0 && !hasInvites ? (
            <div className="px-3 py-2 text-xs text-text-secondary">
              Loading workspaces…
            </div>
          ) : (
            <div className="py-1 max-h-72 overflow-auto">
              {workspaces.map((w) => (
                <Link
                  key={w.id}
                  href={`/${w.slug}`}
                  onClick={() => setOpen(false)}
                  className={cn(
                    "block px-3 py-1.5 text-sm transition-colors cursor-pointer truncate",
                    w.slug === currentSlug
                      ? "bg-white/[0.06] text-text-primary"
                      : "text-text-secondary hover:bg-white/[0.04] hover:text-text-primary",
                  )}
                >
                  {w.name}
                </Link>
              ))}
            </div>
          )}

          {hasInvites && (
            <div className="border-t border-white/[0.06] py-1">
              <p className="px-3 pt-1 pb-1 text-[10px] uppercase tracking-wider text-text-secondary/60">
                Invitations
              </p>
              {invitations.map((inv) => {
                const accepting = acceptingToken === inv.token;
                return (
                  <div
                    key={inv.token}
                    className="flex items-center gap-2 px-3 py-1.5"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-text-primary truncate">
                        {inv.workspaceName}
                      </p>
                      <p className="text-[10px] uppercase tracking-wider text-text-secondary/50">
                        Invited as {inv.invitedRole}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleAccept(inv)}
                      disabled={accepting}
                      className="shrink-0 h-6 px-2 rounded-md bg-white text-black text-[11px] font-medium hover:bg-white/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
                    >
                      {accepting ? "…" : "Accept"}
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          <div className="border-t border-white/[0.06] py-1">
            <Link
              href="/workspaces"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2 px-3 py-1.5 text-sm text-text-secondary hover:bg-white/[0.04] hover:text-text-primary transition-colors cursor-pointer"
            >
              <Plus size={13} className="shrink-0" />
              New workspace
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

function SidebarSearchRow() {
  return (
    <div className="flex items-center gap-2 px-3 py-3 border-b border-white/[0.06]">
      <button
        type="button"
        className="flex-1 flex items-center justify-between gap-2 px-2 py-1.5 rounded-md border border-white/[0.06] hover:bg-white/[0.04] transition-colors cursor-pointer"
      >
        <span className="flex items-center gap-1.5 text-xs text-text-secondary">
          <kbd className="font-mono px-1 py-0.5 rounded bg-white/[0.06] border border-white/[0.1] text-[10px] text-text-secondary/70">
            K
          </kbd>
          Quick Actions
        </span>
        <kbd className="font-mono text-[10px] text-text-secondary/40">⌘K</kbd>
      </button>
      <button
        type="button"
        aria-label="Search"
        className="flex items-center gap-1.5 px-2 py-1.5 rounded-md border border-white/[0.06] hover:bg-white/[0.04] transition-colors cursor-pointer"
      >
        <Search size={13} className="text-text-secondary/60" />
        <kbd className="font-mono text-[10px] text-text-secondary/40">/</kbd>
      </button>
    </div>
  );
}

interface NavProps {
  pathname: string;
  workspaceSlug: string | null;
  workspaceId: string | null;
}

function SidebarNav({ pathname, workspaceSlug, workspaceId }: NavProps) {
  const segments = pathname.split("/").filter(Boolean);
  const lastSegment = segments[segments.length - 1] ?? "";

  return (
    <nav className="flex flex-col gap-0.5 px-2 py-2">
      {navItems.map((item) => {
        const Icon = item.icon;

        // Knowledge + Skills get their own collapsible sub-lists. The
        // other sections render as plain links / disabled buttons.
        if (item.section === "knowledge") {
          return (
            <KnowledgeNavSection
              key={item.section}
              pathname={pathname}
              workspaceSlug={workspaceSlug}
              workspaceId={workspaceId}
            />
          );
        }
        if (item.section === "skills") {
          return (
            <SkillsNavSection
              key={item.section}
              pathname={pathname}
              workspaceSlug={workspaceSlug}
              workspaceId={workspaceId}
            />
          );
        }

        const active =
          item.section === "canvas"
            ? isCanvasPath(pathname)
            : lastSegment === item.section;
        const className = cn(
          "flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-sm transition-colors cursor-pointer",
          active
            ? "bg-white/[0.06] text-text-primary"
            : "text-text-secondary hover:bg-white/[0.04] hover:text-text-primary",
        );
        const inner = (
          <>
            <Icon size={15} className="shrink-0" />
            <span>{item.label}</span>
          </>
        );

        if (workspaceSlug) {
          return (
            <Link
              key={item.section}
              href={sectionPathFor(workspaceSlug, item.section)}
              className={className}
            >
              {inner}
            </Link>
          );
        }
        // No workspace yet (route doesn't carry one) — render as a
        // disabled-looking button so the layout doesn't shift.
        return (
          <button
            key={item.section}
            type="button"
            className={cn(className, "opacity-60")}
            disabled
          >
            {inner}
          </button>
        );
      })}
    </nav>
  );
}

/**
 * Knowledge nav row + collapsible KB list. The whole row toggles the
 * dropdown; there's no longer a root `/knowledge` index page to
 * navigate to. The user picks a specific KB from the dropdown to enter
 * its detail page.
 */
function KnowledgeNavSection({ pathname, workspaceSlug, workspaceId }: NavProps) {
  const router = useRouter();
  const segments = pathname.split("/").filter(Boolean);
  const isOnKnowledge =
    segments.length >= 2 &&
    !RESERVED_WORKSPACE_SLUGS.has(segments[0]) &&
    segments[1] === "knowledge";
  const currentKbSlug = isOnKnowledge ? segments[2] ?? null : null;

  const [expanded, setExpanded] = useState(isOnKnowledge);
  const [creating, setCreating] = useState(false);
  const { data: bases, status, refetch } = useKnowledgeBases(
    workspaceId ?? undefined
  );
  // Live-update on KB renames / creates / deletes anywhere in the
  // workspace (e.g. inline rename on the detail page) so the
  // sidebar reflects the change without a page reload.
  useKnowledgeRealtime(workspaceId ?? undefined, refetch);
  const kbsForRender = bases ?? [];

  /**
   * Instant-create a base named "Untitled", seed a README so the tree
   * isn't empty, and route the user to the new KB's detail page where
   * they can rename inline. Failure of the README seed is non-fatal —
   * the base still exists and is renamable.
   */
  async function handleAddNew() {
    if (!workspaceSlug || !workspaceId || creating) return;
    setCreating(true);
    try {
      const base = await apiCreateBase(
        { name: "Untitled", description: null, agentWriteEnabled: false },
        workspaceId
      );
      try {
        await apiCreateEntry(
          base.id,
          {
            folderId: null,
            title: "README",
            excerpt: null,
            body: DEFAULT_KB_README_BODY,
            entryType: "note",
            position: 0,
          },
          workspaceId
        );
      } catch {
        // Non-fatal — base creation succeeded, user can add entries
        // manually from the detail page.
      }
      refetch();
      setExpanded(true);
      router.push(`/${workspaceSlug}/knowledge/${base.slug}`);
    } catch (err) {
      toast({
        title: "Couldn't create knowledge base",
        description: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setCreating(false);
    }
  }

  const rowClassName = cn(
    "w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-sm transition-colors cursor-pointer text-left",
    isOnKnowledge
      ? "bg-white/[0.06] text-text-primary"
      : "text-text-secondary hover:bg-white/[0.04] hover:text-text-primary",
  );

  return (
    <>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className={rowClassName}
      >
        <BookOpen size={15} className="shrink-0" />
        <span className="flex-1 text-left">Knowledge</span>
        {expanded ? (
          <ChevronDown size={13} className="text-text-secondary/60 shrink-0" />
        ) : (
          <ChevronRight size={13} className="text-text-secondary/60 shrink-0" />
        )}
      </button>

      {expanded && (
        <div className="ml-4 mt-0.5 mb-1 flex flex-col gap-0.5 border-l border-white/[0.06] pl-2">
          {status === "loading" && kbsForRender.length === 0 ? (
            <div className="px-2 py-1 text-xs text-text-secondary/60">
              Loading…
            </div>
          ) : null}
          {kbsForRender.map((kb) => {
            const itemActive = kb.slug === currentKbSlug;
            const itemClass = cn(
              "block px-2 py-1 rounded-md text-xs transition-colors cursor-pointer truncate",
              itemActive
                ? "bg-white/[0.06] text-text-primary"
                : "text-text-secondary hover:bg-white/[0.04] hover:text-text-primary",
            );
            const itemInner = <span className="truncate">{kb.name}</span>;
            if (workspaceSlug) {
              return (
                <Link
                  key={kb.slug}
                  href={`/${workspaceSlug}/knowledge/${kb.slug}`}
                  className={itemClass}
                >
                  {itemInner}
                </Link>
              );
            }
            return (
              <span key={kb.slug} className={cn(itemClass, "opacity-60")}>
                {itemInner}
              </span>
            );
          })}
          {workspaceSlug && (
            <button
              type="button"
              onClick={handleAddNew}
              disabled={creating || !workspaceId}
              className={cn(
                "flex items-center gap-1.5 px-2 py-1 rounded-md text-xs transition-colors cursor-pointer text-left",
                "text-text-secondary/70 hover:bg-white/[0.04] hover:text-text-primary",
                "disabled:opacity-50 disabled:cursor-default disabled:hover:bg-transparent",
              )}
            >
              <Plus size={11} className="shrink-0" />
              <span className="truncate">
                {creating ? "Creating…" : "Add new knowledge base"}
              </span>
            </button>
          )}
        </div>
      )}
    </>
  );
}

/**
 * Skills nav row + collapsible list. Mirrors KnowledgeNavSection —
 * auto-expands when on /skills/*, label routes to the skills index,
 * chevron toggles expansion. Children are the workspace's skills,
 * each linking to its detail page.
 */
function SkillsNavSection({ pathname, workspaceSlug, workspaceId }: NavProps) {
  const router = useRouter();
  const segments = pathname.split("/").filter(Boolean);
  const isOnSkills =
    segments.length >= 2 &&
    !RESERVED_WORKSPACE_SLUGS.has(segments[0]) &&
    segments[1] === "skills";
  const currentSkillSlug = isOnSkills ? segments[2] ?? null : null;

  const [expanded, setExpanded] = useState(isOnSkills);
  const [creating, setCreating] = useState(false);
  const { data: skills, status, refetch } = useSkills(workspaceId ?? undefined);
  // Live-update on skill renames / creates / deletes.
  useSkillsRealtime(workspaceId ?? undefined, refetch);
  const skillsForRender = skills ?? [];

  /**
   * Instant-create a skill named "Untitled" in `draft` state with a
   * default SKILL.md body, then route to the detail page where the
   * user can rename inline.
   */
  async function handleAddNew() {
    if (!workspaceSlug || !workspaceId || creating) return;
    setCreating(true);
    try {
      // SkillCreateSchema requires non-empty `description` and
      // `whenToUse` (min 1 char). Seed both with placeholder text the
      // user is expected to overwrite — better than rejecting the
      // create with a 400 just because the user clicked + Add new.
      const result = await apiCreateSkill(
        {
          name: "Untitled",
          description: "Describe what this skill does.",
          whenToUse: "Describe when the agent should invoke this skill.",
          status: "draft",
          body: DEFAULT_SKILL_BODY,
        },
        workspaceId
      );
      refetch();
      setExpanded(true);
      router.push(`/${workspaceSlug}/skills/${result.skill.slug}`);
    } catch (err) {
      toast({
        title: "Couldn't create skill",
        description: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setCreating(false);
    }
  }

  const rowClassName = cn(
    "w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-sm transition-colors cursor-pointer text-left",
    isOnSkills
      ? "bg-white/[0.06] text-text-primary"
      : "text-text-secondary hover:bg-white/[0.04] hover:text-text-primary",
  );

  return (
    <>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className={rowClassName}
      >
        <Sparkles size={15} className="shrink-0" />
        <span className="flex-1 text-left">Skills</span>
        {expanded ? (
          <ChevronDown size={13} className="text-text-secondary/60 shrink-0" />
        ) : (
          <ChevronRight size={13} className="text-text-secondary/60 shrink-0" />
        )}
      </button>

      {expanded && (
        <div className="ml-4 mt-0.5 mb-1 flex flex-col gap-0.5 border-l border-white/[0.06] pl-2">
          {status === "loading" && skillsForRender.length === 0 ? (
            <div className="px-2 py-1 text-xs text-text-secondary/60">
              Loading…
            </div>
          ) : null}
          {skillsForRender.map((skill) => {
            const itemActive = skill.slug === currentSkillSlug;
            const itemClass = cn(
              "block px-2 py-1 rounded-md text-xs transition-colors cursor-pointer truncate",
              itemActive
                ? "bg-white/[0.06] text-text-primary"
                : "text-text-secondary hover:bg-white/[0.04] hover:text-text-primary",
            );
            const itemInner = <span className="truncate">{skill.name}</span>;
            if (workspaceSlug) {
              return (
                <Link
                  key={skill.slug}
                  href={`/${workspaceSlug}/skills/${skill.slug}`}
                  className={itemClass}
                >
                  {itemInner}
                </Link>
              );
            }
            return (
              <span key={skill.slug} className={cn(itemClass, "opacity-60")}>
                {itemInner}
              </span>
            );
          })}
          {workspaceSlug && (
            <button
              type="button"
              onClick={handleAddNew}
              disabled={creating || !workspaceId}
              className={cn(
                "flex items-center gap-1.5 px-2 py-1 rounded-md text-xs transition-colors cursor-pointer text-left",
                "text-text-secondary/70 hover:bg-white/[0.04] hover:text-text-primary",
                "disabled:opacity-50 disabled:cursor-default disabled:hover:bg-transparent",
              )}
            >
              <Plus size={11} className="shrink-0" />
              <span className="truncate">
                {creating ? "Creating…" : "Add new skill"}
              </span>
            </button>
          )}
        </div>
      )}
    </>
  );
}
