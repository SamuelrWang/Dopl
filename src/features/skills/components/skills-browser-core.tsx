"use client";

import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2, Zap } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { EmptyState } from "@/shared/ui/empty-state";
import { SearchField } from "@/shared/ui/search-field";
import { SegmentedControl } from "@/shared/ui/segmented-control";
import type { ResolvedSkill, Skill, SkillStatus } from "@/features/skills/types";
import { skillScope, SKILL_SCOPE_LABEL, type SkillScope } from "@/features/skills/scope";
import { fetchSkill } from "@/features/skills/client/api";
import { SHARE_SCOPE_ICONS } from "@/shared/ui/scope-share-popover";
import { SkillView } from "./skill-view";
import { SkillViewSkeleton } from "./skill-view-skeleton";
import { SkillsTrashModal } from "./skills-trash-modal";

const ICON_BTN =
  "flex h-7 w-7 items-center justify-center rounded-[7px] text-text-secondary transition-colors hover:bg-surface-raised-1 hover:text-text-primary";

type SkillFilter = "all" | SkillScope;

const FILTERS: ReadonlyArray<{ key: SkillFilter; label: string }> = [
  { key: "all", label: "All" },
  { key: "private", label: "Private" },
  { key: "team", label: "Team" },
  { key: "workspace", label: "Shared" },
];

const EMPTY_COPY: Record<SkillFilter, string> = {
  all: "No skills yet — ask your agent to create one with dopl_skill.",
  private: "No private skills — new skills you create start here.",
  team: "No skills have been shared with your teams yet.",
  workspace: "No skills have been shared with the workspace yet.",
};

/** Postgres timestamps are full ISO strings; render "Jul 8". */
function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

export interface SkillsBrowserCoreProps {
  workspaceSlug: string;
  workspaceId: string;
  currentUserId: string;
  isAdmin: boolean;
  skills: Skill[];
  /**
   * The `skills` list is stale — re-pull it. Injected because the two apps
   * have no shared refresh concept: the web app passes `router.refresh()`
   * (the list is RSC props), the desktop SPA passes a TanStack
   * `invalidateQueries(["/api/skills"])`.
   */
  onListChanged: () => void;
}

/**
 * Skills index — two-pane .page-float browser matching the chats /
 * knowledge pattern: the scope-filtered list on the left (All / Private
 * / Shared), the selected skill's FULL tabbed editor on the right. No
 * separate detail route — selecting a row loads the editor in place.
 *
 * Next-free by construction: `./skills-browser.tsx` is the web app's thin
 * wrapper that supplies `onListChanged` from `next/navigation`, and the
 * desktop SPA renders this component directly
 * (apps/desktop-ui/src/pages/skills/index.tsx).
 */
export function SkillsBrowserCore({
  workspaceSlug,
  workspaceId,
  currentUserId,
  isAdmin,
  skills,
  onListChanged,
}: SkillsBrowserCoreProps) {
  const [trashOpen, setTrashOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<SkillFilter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(
    skills[0]?.id ?? null
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return skills.filter((s) => {
      if (filter !== "all" && skillScope(s) !== filter) return false;
      if (!q) return true;
      return (
        s.name.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q)
      );
    });
  }, [skills, query, filter]);

  // Group the visible list by folder; unfiled last. The direction is
  // many small skills, so folders are the primary organizing axis.
  const groups = useMemo(() => {
    const byFolder = new Map<string, Skill[]>();
    for (const s of visible) {
      const key = s.folder ?? "";
      byFolder.set(key, [...(byFolder.get(key) ?? []), s]);
    }
    return [...byFolder.entries()].sort(([a], [b]) => {
      if (a === "") return 1;
      if (b === "") return -1;
      return a.localeCompare(b);
    });
  }, [visible]);

  // Keep the selection when it survives the filter/search; otherwise
  // fall to the first visible row (chats' handleFilterChange pattern).
  const selected =
    visible.find((s) => s.id === selectedId) ?? visible[0] ?? null;

  const handleFilterChange = (next: SkillFilter) => {
    setFilter(next);
    const onFilter = (s: Skill) => next === "all" || skillScope(s) === next;
    if (!skills.some((s) => s.id === selectedId && onFilter(s))) {
      setSelectedId(skills.find(onFilter)?.id ?? null);
    }
  };

  return (
    <div className="page-float flex antialiased">
      {/* Left list pane */}
      <div className="flex w-[372px] shrink-0 flex-col border-r border-border-default">
        <div className="flex items-center gap-2 px-3.5 pb-2.5 pt-3.5">
          <h1 className="text-title font-semibold tracking-tight text-text-primary">
            Skills
          </h1>
          <span className="text-caption text-text-muted">{skills.length}</span>
          <span className="flex-1" />
          <button
            type="button"
            onClick={() => setTrashOpen(true)}
            title="View recently deleted skills"
            aria-label="Trash"
            className={ICON_BTN}
          >
            <Trash2 size={15} />
          </button>
          <button
            type="button"
            disabled
            title="Skill authoring lands in the next milestone — ask your agent to create one via dopl_skill"
            aria-label="New skill"
            className="flex h-7 w-7 cursor-not-allowed items-center justify-center rounded-[7px] text-text-disabled"
          >
            <Plus size={16} />
          </button>
        </div>

        <SearchField
          value={query}
          onChange={setQuery}
          placeholder="Search skills"
          className="mx-3.5 mb-3"
        />

        <SegmentedControl
          options={FILTERS}
          value={filter}
          onChange={handleFilterChange}
          className="mx-3.5 mb-3"
        />

        <div className="min-h-0 flex-1 overflow-y-auto border-t border-border-default pb-4">
          {visible.length === 0 ? (
            <p className="px-4 py-2.5 text-caption leading-relaxed text-text-muted">
              {query.trim() ? "No skills match." : EMPTY_COPY[filter]}
            </p>
          ) : (
            groups.map(([folder, rows]) => (
              <div key={folder || "__unfiled"}>
                <p className="px-4 pb-1 pt-3 text-label font-medium uppercase tracking-wider text-text-muted">
                  {folder === "" ? "Unfiled" : folder}
                </p>
                {rows.map((skill) => (
                  <SkillRow
                    key={skill.id}
                    skill={skill}
                    selected={selected?.id === skill.id}
                    onSelect={() => setSelectedId(skill.id)}
                  />
                ))}
              </div>
            ))
          )}
        </div>
      </div>

      {/* Right pane — the full editor for the selected skill */}
      <DetailPane
        skill={selected}
        workspaceSlug={workspaceSlug}
        workspaceId={workspaceId}
        currentUserId={currentUserId}
        isAdmin={isAdmin}
        totalSkills={skills.length}
        onDuplicated={(created) => setSelectedId(created.id)}
        onListChanged={onListChanged}
      />

      <SkillsTrashModal
        open={trashOpen}
        onOpenChange={setTrashOpen}
        workspaceId={workspaceId}
        // The list came from outside this component — pull the restored
        // skill back in (same pattern as skill-view's duplicate flow).
        onRestored={onListChanged}
      />
    </div>
  );
}

function SkillRow({
  skill,
  selected,
  onSelect,
}: {
  skill: Skill;
  selected: boolean;
  onSelect: () => void;
}) {
  const scope = skillScope(skill);
  const ScopeIcon = SHARE_SCOPE_ICONS[scope];
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "relative flex w-full flex-col gap-0.5 border-b border-border-subtle px-4 py-2 text-left transition-colors",
        selected ? "bg-surface-raised-3" : "hover:bg-surface-raised-1"
      )}
    >
      {selected && (
        <span className="absolute bottom-1.5 left-0 top-1.5 w-[3px] rounded-r-[3px] bg-text-primary" />
      )}
      <span className="flex w-full items-center gap-1.5">
        <span className="min-w-0 flex-1 truncate text-body font-semibold text-text-primary">
          {skill.name}
        </span>
        {skill.status === "draft" && <StatusChip status="draft" />}
        <span className="shrink-0 text-micro text-text-muted">
          {shortDate(skill.updatedAt)}
        </span>
      </span>
      <span className="flex w-full items-center gap-1.5 text-caption text-text-secondary">
        <ScopeIcon size={11} className="shrink-0 text-text-muted" />
        <span>{SKILL_SCOPE_LABEL[scope]}</span>
        {skill.description && (
          <>
            <span className="text-text-muted">·</span>
            <span className="min-w-0 truncate">{skill.description}</span>
          </>
        )}
      </span>
    </button>
  );
}

function StatusChip({ status }: { status: SkillStatus }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-px text-micro font-medium uppercase tracking-wide",
        status === "active"
          ? "border-border-strong bg-bg-inset text-text-primary"
          : "border-border-default bg-surface-raised-2 text-text-secondary"
      )}
    >
      <span
        className={cn(
          "h-1 w-1 rounded-full",
          status === "active" ? "bg-success" : "bg-text-muted"
        )}
      />
      {status}
    </span>
  );
}

/**
 * Right pane: loads the selected skill's full body client-side and
 * renders the inline `SkillView` editor, keyed by skill id so switching
 * rows remounts fresh editor state (and flushes pending saves).
 */
function DetailPane({
  skill,
  workspaceSlug,
  workspaceId,
  currentUserId,
  isAdmin,
  totalSkills,
  onDuplicated,
  onListChanged,
}: {
  skill: Skill | null;
  workspaceSlug: string;
  workspaceId: string;
  currentUserId: string;
  isAdmin: boolean;
  totalSkills: number;
  onDuplicated: (skill: Skill) => void;
  onListChanged: () => void;
}) {
  const [resolved, setResolved] = useState<ResolvedSkill | null>(null);
  const [failed, setFailed] = useState(false);
  const slug = skill?.slug ?? null;

  // Reset for the incoming skill during render (sanctioned
  // adjust-state-during-render pattern — no effect round-trip).
  const [lastSlug, setLastSlug] = useState(slug);
  if (lastSlug !== slug) {
    setLastSlug(slug);
    setResolved(null);
    setFailed(false);
  }

  useEffect(() => {
    if (!slug) return;
    let cancelled = false;
    // Scope the fetch to the workspace being viewed. Without the
    // X-Workspace-Id header the route falls back to the caller's DEFAULT
    // workspace (resolveActiveWorkspace) — so on any non-default
    // workspace the slug 404s and the pane shows "Couldn't load".
    fetchSkill(slug, workspaceId)
      .then((r) => {
        if (!cancelled) setResolved(r);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [slug, workspaceId]);

  if (!skill) {
    return totalSkills === 0 ? (
      <EmptyState
        icon={Zap}
        title="No skills yet."
        description={
          <>
            Skills are procedural prompts your connected agent discovers over
            MCP. Ask your agent to create one with{" "}
            <code className="rounded bg-bg-inset px-1">dopl_skill</code>.
          </>
        }
      />
    ) : (
      <EmptyState icon={Zap} title="Select a skill to read it." />
    );
  }

  if (failed) {
    return (
      <div className="flex min-w-0 flex-1 items-center justify-center px-10">
        <p className="text-body text-text-muted">
          Couldn&apos;t load {skill.name} — select it again to retry.
        </p>
      </div>
    );
  }

  if (!resolved || resolved.skill.id !== skill.id) {
    return (
      <div className="min-w-0 flex-1 overflow-hidden">
        <SkillViewSkeleton />
      </div>
    );
  }

  return (
    <SkillView
      key={resolved.skill.id}
      resolved={resolved}
      workspaceSlug={workspaceSlug}
      workspaceId={workspaceId}
      isAdmin={isAdmin}
      currentUserId={currentUserId}
      onDuplicated={onDuplicated}
      onListChanged={onListChanged}
    />
  );
}
