"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BookOpen,
  ChevronDown,
  ChevronRight,
  Edit2,
  Eye,
  Home,
  LayoutGrid,
  MessageSquare,
  Plus,
  Search,
  Sparkles,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { parseSegment } from "@/shared/lib/url/parse-segment";
import { workspaceSegmentFromPath } from "@/shared/lib/url/workspace-segment";
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
import { useMyAccessContext } from "@/features/members/hooks/use-my-access";
import type { AccessLevel } from "@/features/members/access-defaults";
import { meetsLevel } from "@/features/members/access-defaults";
import { toast } from "@/shared/ui/toast";
import { Tooltip } from "@/shared/ui/tooltip";
import { WorkspaceSwitcher } from "./workspace-switcher";
import type {
  PendingInvitation,
  WorkspaceLike,
} from "./workspace-switcher";

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

function workspaceLikeSegment(ws: WorkspaceLike): string {
  return `${ws.slug}-${ws.publicId}`;
}

type NavSection =
  | "overview"
  | "canvas"
  | "chat"
  | "knowledge"
  | "skills"
  | "members";

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
  { label: "Members", icon: Users, section: "members" },
];

/** Static workspace sub-routes — anything matching `/{ws}/<one of these>`
 * is a named sub-page, not a canvas slug. Used by `isCanvasPath` to
 * keep the Canvas nav item from claiming the active state on these. */
const NAMED_WORKSPACE_SUBROUTES: ReadonlyArray<string> = [
  "overview",
  "chat",
  "knowledge",
  "skills",
  "settings",
];

// `workspaceSegmentFromPath` moved to `@/shared/lib/url/workspace-segment`
// so the layout shell + sidebar agree on what "the current workspace"
// is and the my-access provider can mount with the same scope.

/**
 * Match a path's first segment to a workspace in the user's list.
 * Prefers publicId match (canonical URLs), falls back to slug match
 * (legacy URLs during the deletion window).
 */
function matchWorkspace(
  workspaces: WorkspaceLike[],
  pathSegment: string | null
): WorkspaceLike | null {
  if (!pathSegment || workspaces.length === 0) return null;
  const parsed = parseSegment(pathSegment);
  if (parsed) {
    const byId = workspaces.find((w) => w.publicId === parsed.publicId);
    if (byId) return byId;
  }
  return workspaces.find((w) => w.slug === pathSegment) ?? null;
}

function isCanvasPath(pathname: string): boolean {
  if (pathname === "/canvas" || pathname.startsWith("/canvas/")) return true;
  const segments = pathname.split("/").filter(Boolean);
  // /{wsSegment}/{canvasSlug} when the first segment is a workspace
  // handle (i.e. not reserved) and the second segment isn't one of the
  // named workspace sub-routes.
  if (segments.length < 2) return false;
  if (RESERVED_WORKSPACE_SLUGS.has(segments[0])) return false;
  return !NAMED_WORKSPACE_SUBROUTES.includes(segments[1]);
}

function sectionPathFor(segment: string, section: NavSection): string {
  if (section === "canvas") return `/${segment}`;
  return `/${segment}/${section}`;
}

export function Sidebar() {
  const pathname = usePathname();
  const pathSegment = workspaceSegmentFromPath(pathname);
  const { workspaces, currentWorkspace, refresh: refreshWorkspaces } =
    useWorkspaces(pathSegment);
  const { invitations, refresh: refreshInvitations } =
    usePendingInvitations();
  const fallbackName = currentWorkspace?.name ?? "Workspace";
  const currentSegment = currentWorkspace
    ? workspaceLikeSegment(currentWorkspace)
    : pathSegment;

  return (
    <aside
      className="hidden md:flex fixed inset-y-0 left-0 w-64 z-10 flex-col overflow-hidden pointer-events-auto"
    >
      <WorkspaceSwitcher
        current={currentWorkspace}
        currentName={fallbackName}
        currentSegment={currentSegment ?? "default"}
        workspaces={workspaces}
        invitations={invitations}
        onAccepted={() => {
          refreshInvitations();
          refreshWorkspaces();
        }}
        onWorkspacesChanged={refreshWorkspaces}
      />
      <SidebarSearchRow />
      {/* Nav region claims the remaining height and scrolls internally
          when the list of expanded KBs / skills overflows. min-h-0 is
          required for overflow-y to work inside a flex column. */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        <SidebarNav
          pathname={pathname}
          workspaceSegment={currentSegment}
          workspaceId={currentWorkspace?.id ?? null}
        />
      </div>
    </aside>
  );
}

function useWorkspaces(activeSegment: string | null) {
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
    const match = matchWorkspace(workspaces, activeSegment);
    return match ?? workspaces[0];
  }, [workspaces, activeSegment]);

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

function SidebarSearchRow() {
  return (
    <div className="flex items-center gap-2 px-3 py-3 border-b border-border-subtle">
      <button
        type="button"
        className="flex-1 flex items-center justify-between gap-2 px-2 py-1.5 rounded-md border border-border-subtle hover:bg-surface-raised-2 transition-colors cursor-pointer"
      >
        <span className="flex items-center gap-1.5 text-xs text-text-secondary">
          <kbd className="font-mono px-1 py-0.5 rounded bg-surface-raised-3 border border-border-default text-[10px] text-text-secondary/70">
            K
          </kbd>
          Quick Actions
        </span>
        <kbd className="font-mono text-[10px] text-text-secondary/40">⌘K</kbd>
      </button>
      <button
        type="button"
        aria-label="Search"
        className="flex items-center gap-1.5 px-2 py-1.5 rounded-md border border-border-subtle hover:bg-surface-raised-2 transition-colors cursor-pointer"
      >
        <Search size={13} className="text-text-secondary/60" />
        <kbd className="font-mono text-[10px] text-text-secondary/40">/</kbd>
      </button>
    </div>
  );
}

interface NavProps {
  pathname: string;
  workspaceSegment: string | null;
  workspaceId: string | null;
}

function SidebarNav({ pathname, workspaceSegment, workspaceId }: NavProps) {
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
              workspaceSegment={workspaceSegment}
              workspaceId={workspaceId}
            />
          );
        }
        if (item.section === "skills") {
          return (
            <SkillsNavSection
              key={item.section}
              pathname={pathname}
              workspaceSegment={workspaceSegment}
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
            ? "bg-surface-selected text-text-primary"
            : "text-text-secondary hover:bg-surface-raised-2 hover:text-text-primary",
        );
        const inner = (
          <>
            <Icon size={15} className="shrink-0" />
            <span>{item.label}</span>
          </>
        );

        if (workspaceSegment) {
          return (
            <Link
              key={item.section}
              href={sectionPathFor(workspaceSegment, item.section)}
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
function KnowledgeNavSection({ pathname, workspaceSegment, workspaceId }: NavProps) {
  const router = useRouter();
  const segments = pathname.split("/").filter(Boolean);
  const isOnKnowledge =
    segments.length >= 2 &&
    !RESERVED_WORKSPACE_SLUGS.has(segments[0]) &&
    segments[1] === "knowledge";
  const currentKbSegment = isOnKnowledge ? segments[2] ?? null : null;
  const currentKbPublicId = currentKbSegment
    ? parseSegment(currentKbSegment)?.publicId ?? null
    : null;

  const [expanded, setExpanded] = useState(isOnKnowledge);
  const [creating, setCreating] = useState(false);
  const { data: bases, status, refetch } = useKnowledgeBases(
    workspaceId ?? undefined
  );
  // Live-update on KB renames / creates / deletes anywhere in the
  // workspace (e.g. inline rename on the detail page) so the
  // sidebar reflects the change without a page reload.
  useKnowledgeRealtime(workspaceId ?? undefined, refetch);
  // Access info for read/edit badges. The provider lives in the
  // layout shell so the request is shared across both nav sections,
  // the canvas panels, and the detail pages — single round trip per
  // workspace load. (Audit A-008.)
  const access = useMyAccessContext();
  const resolveAccess = access.resolve;
  // Read-only members shouldn't see the "Add new knowledge base"
  // affordance — clicking it would just hit a 403. defaultLevel is
  // null until the access fetch resolves; treat as "edit" then so
  // the button isn't briefly hidden then re-shown for owners/admins.
  const canCreate =
    access.data == null ? true : meetsLevel(access.data.defaultLevel, "edit");
  const kbsForRender = bases ?? [];

  /**
   * Instant-create a base named "Untitled", seed a README so the tree
   * isn't empty, and route the user to the new KB's detail page where
   * they can rename inline. Failure of the README seed is non-fatal —
   * the base still exists and is renamable.
   */
  async function handleAddNew() {
    if (!workspaceSegment || !workspaceId || creating) return;
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
      // Audit A-009: kick the access cache so the new KB's badge
      // reflects the resolved level rather than flashing the cached
      // default until the next workspace nav.
      access.refetch();
      setExpanded(true);
      router.push(
        `/${workspaceSegment}/knowledge/${base.slug}-${base.publicId}`
      );
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
      ? "bg-surface-selected text-text-primary"
      : "text-text-secondary hover:bg-surface-raised-2 hover:text-text-primary",
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
        <div className="ml-4 mt-0.5 mb-1 flex flex-col gap-0.5 border-l border-border-subtle pl-2">
          {status === "loading" && kbsForRender.length === 0 ? (
            <div className="px-2 py-1 text-xs text-text-secondary/60">
              Loading…
            </div>
          ) : null}
          {kbsForRender.map((kb) => {
            const itemActive = currentKbPublicId
              ? kb.publicId === currentKbPublicId
              : kb.slug === currentKbSegment;
            const itemClass = cn(
              "flex items-center gap-1.5 px-2 py-1 rounded-md text-xs transition-colors cursor-pointer",
              itemActive
                ? "bg-surface-selected text-text-primary"
                : "text-text-secondary hover:bg-surface-raised-2 hover:text-text-primary",
            );
            const level = resolveAccess("knowledge_base", kb.id);
            const itemInner = (
              <>
                <span className="truncate flex-1">{kb.name}</span>
                <AccessIcon level={level} />
              </>
            );
            if (workspaceSegment) {
              return (
                <Link
                  key={kb.id}
                  href={`/${workspaceSegment}/knowledge/${kb.slug}-${kb.publicId}`}
                  className={itemClass}
                >
                  {itemInner}
                </Link>
              );
            }
            return (
              <span key={kb.id} className={cn(itemClass, "opacity-60")}>
                {itemInner}
              </span>
            );
          })}
          {/* Audit A-005: hide the create affordance from read-only
           * members. Server enforces (creates 403), but a button that
           * always 403s is bad UX. canCreate falls open to true while
           * access is still loading so admins/owners don't see a flash
           * of the button missing. */}
          {workspaceSegment && canCreate && (
            <button
              type="button"
              onClick={handleAddNew}
              disabled={creating || !workspaceId}
              className={cn(
                "flex items-center gap-1.5 px-2 py-1 rounded-md text-xs transition-colors cursor-pointer text-left",
                "text-text-secondary/70 hover:bg-surface-raised-2 hover:text-text-primary",
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
function SkillsNavSection({ pathname, workspaceSegment, workspaceId }: NavProps) {
  const router = useRouter();
  const segments = pathname.split("/").filter(Boolean);
  const isOnSkills =
    segments.length >= 2 &&
    !RESERVED_WORKSPACE_SLUGS.has(segments[0]) &&
    segments[1] === "skills";
  const currentSkillSegment = isOnSkills ? segments[2] ?? null : null;
  const currentSkillPublicId = currentSkillSegment
    ? parseSegment(currentSkillSegment)?.publicId ?? null
    : null;

  const [expanded, setExpanded] = useState(isOnSkills);
  const [creating, setCreating] = useState(false);
  const { data: skills, status, refetch } = useSkills(workspaceId ?? undefined);
  // Live-update on skill renames / creates / deletes.
  useSkillsRealtime(workspaceId ?? undefined, refetch);
  // Access info via the shared layout-shell provider — no duplicate
  // fetch with KnowledgeNavSection. (Audit A-008.)
  const access = useMyAccessContext();
  const resolveAccess = access.resolve;
  const canCreate =
    access.data == null ? true : meetsLevel(access.data.defaultLevel, "edit");
  const skillsForRender = skills ?? [];

  /**
   * Instant-create a skill named "Untitled" in `draft` state with a
   * default SKILL.md body, then route to the detail page where the
   * user can rename inline.
   */
  async function handleAddNew() {
    if (!workspaceSegment || !workspaceId || creating) return;
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
      // Audit A-009: keep the access cache in sync so the new skill
      // gets a correct badge instead of falling back to the cached
      // default level.
      access.refetch();
      setExpanded(true);
      router.push(
        `/${workspaceSegment}/skills/${result.skill.slug}-${result.skill.publicId}`
      );
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
      ? "bg-surface-selected text-text-primary"
      : "text-text-secondary hover:bg-surface-raised-2 hover:text-text-primary",
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
        <div className="ml-4 mt-0.5 mb-1 flex flex-col gap-0.5 border-l border-border-subtle pl-2">
          {status === "loading" && skillsForRender.length === 0 ? (
            <div className="px-2 py-1 text-xs text-text-secondary/60">
              Loading…
            </div>
          ) : null}
          {skillsForRender.map((skill) => {
            const itemActive = currentSkillPublicId
              ? skill.publicId === currentSkillPublicId
              : skill.slug === currentSkillSegment;
            const itemClass = cn(
              "flex items-center gap-1.5 px-2 py-1 rounded-md text-xs transition-colors cursor-pointer",
              itemActive
                ? "bg-surface-selected text-text-primary"
                : "text-text-secondary hover:bg-surface-raised-2 hover:text-text-primary",
            );
            const level = resolveAccess("skill", skill.id);
            const itemInner = (
              <>
                <span className="truncate flex-1">{skill.name}</span>
                <AccessIcon level={level} />
              </>
            );
            if (workspaceSegment) {
              return (
                <Link
                  key={skill.id}
                  href={`/${workspaceSegment}/skills/${skill.slug}-${skill.publicId}`}
                  className={itemClass}
                >
                  {itemInner}
                </Link>
              );
            }
            return (
              <span key={skill.id} className={cn(itemClass, "opacity-60")}>
                {itemInner}
              </span>
            );
          })}
          {/* Audit A-005: hide from read-only members. canCreate
           * stays true while access is loading — see KnowledgeNavSection
           * for the same reasoning. */}
          {workspaceSegment && canCreate && (
            <button
              type="button"
              onClick={handleAddNew}
              disabled={creating || !workspaceId}
              className={cn(
                "flex items-center gap-1.5 px-2 py-1 rounded-md text-xs transition-colors cursor-pointer text-left",
                "text-text-secondary/70 hover:bg-surface-raised-2 hover:text-text-primary",
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

/**
 * Tiny right-aligned read/edit indicator on each KB / skill sidebar row.
 * Eye icon for read-only, pencil for editable. Hidden until the access
 * fetch resolves so we don't flash the wrong state. Owners and admins
 * always render the pencil (the my-access endpoint short-circuits them
 * to "edit"). Audit A-020 fix: switched from native `title=` (mouse-
 * hover only) to the shared <Tooltip> component, which fires on both
 * hover and keyboard focus.
 */
function AccessIcon({ level }: { level: AccessLevel | null }) {
  if (!level) return null;
  if (level === "edit") {
    return (
      <Tooltip
        label="You can edit this"
        className="shrink-0 text-text-secondary/40"
      >
        <span aria-label="You can edit this">
          <Edit2 size={10} />
        </span>
      </Tooltip>
    );
  }
  return (
    <Tooltip
      label="Read-only — ask an admin for edit access"
      className="shrink-0 text-text-secondary/40"
    >
      <span aria-label="Read-only">
        <Eye size={10} />
      </span>
    </Tooltip>
  );
}
