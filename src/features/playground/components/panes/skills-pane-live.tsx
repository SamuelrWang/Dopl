"use client";

import { useMemo, useState } from "react";
import { Building2, Folder, History, Lock, Plus, Users } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { SearchField } from "@/shared/ui/search-field";
import { SegmentedControl } from "@/shared/ui/segmented-control";
import { SkeletonText } from "@/shared/ui/skeleton";
import {
  skillScope,
  SKILL_SCOPE_LABEL,
  type SkillScope,
} from "@/features/skills/scope";
import { usePlaygroundPoll } from "../../session";

/**
 * Live half of the playground Skills pane (static demo half:
 * `./skills-pane.tsx`, which also owns the session check and renders this
 * only once `GET /api/skills` has real rows). Mirrors the real browser's
 * behaviour (`src/features/skills/components/skills-browser-core.tsx`):
 * scope filter + search on the summary list, folder groups (unfiled last),
 * detail fetched per slug. Bodies are member/agent-authored markdown —
 * rendered as plain text in the demo prose recipe, never as HTML.
 */

export type PaneFilter = "all" | SkillScope;

export const PANE_FILTERS: ReadonlyArray<{ key: PaneFilter; label: string }> = [
  { key: "all", label: "All" },
  { key: "private", label: "Private" },
  { key: "team", label: "Team" },
  { key: "workspace", label: "Public" },
];

const SCOPE_ICONS: Record<SkillScope, typeof Lock> = {
  private: Lock,
  team: Users,
  workspace: Building2,
};

/** Same copy as the real browser's `EMPTY_COPY`, minus the write CTAs the
 *  playground page can't honor. */
const EMPTY_COPY: Record<PaneFilter, string> = {
  all: "No skills yet — ask your agent to write one with dopl_skill.",
  private: "No private skills yet.",
  team: "No skills have been shared with teams yet.",
  workspace: "No skills are public to the workspace yet.",
};

/** ISO timestamp → "Jul 8" (the real browser's `shortDate`). */
function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

/** `GET /api/skills` fields this pane consumes (full row is `Skill` in
 *  `src/features/skills/types.ts`). */
export interface LiveSkillSummary {
  id: string;
  slug: string;
  name: string;
  description: string;
  visibility: "public" | "private";
  accessMode: "workspace" | "teams";
  folder: string | null;
  updatedAt: string;
}

/** `GET /api/skills/[slug]` (`ResolvedSkill`) fields this pane consumes. */
interface LiveSkillDetail {
  skill: { slug: string };
  files: Array<{ name: string; body: string }>;
}

const PRIMARY_FILE_NAME = "SKILL.md";

export function LiveSkillsPane({ skills }: { skills: LiveSkillSummary[] }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<PaneFilter>("all");
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);

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

  // Group by folder; unfiled last — mirrors the real browser.
  const groups = useMemo(() => {
    const byFolder = new Map<string, LiveSkillSummary[]>();
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

  // Selection survives filter/search when possible; defaults to first row.
  const selected =
    visible.find((s) => s.slug === selectedSlug) ?? visible[0] ?? null;

  const detail = usePlaygroundPoll<LiveSkillDetail>(
    selected ? `/api/skills/${encodeURIComponent(selected.slug)}` : null
  );
  // The poll hook keeps the previous payload while a new path is in flight,
  // so a selection change would briefly show the OLD skill's body under the
  // new header — gate on the slug matching.
  const fresh =
    detail.data && selected && detail.data.skill.slug === selected.slug
      ? detail.data
      : null;

  const selectedScope = selected ? skillScope(selected) : null;
  const SelectedScopeIcon = selectedScope ? SCOPE_ICONS[selectedScope] : null;

  return (
    <div className="page-float flex antialiased">
      {/* List pane */}
      <div className="flex w-[372px] shrink-0 flex-col border-r border-border-default">
        <div className="flex items-center gap-2 px-3.5 pb-2.5 pt-3.5">
          <h1 className="text-title font-semibold tracking-tight text-text-primary">
            Skills
          </h1>
          <span className="text-caption text-text-muted">{skills.length}</span>
          <span className="flex-1" />
          <span
            title="New skill"
            aria-hidden
            className="flex h-7 w-7 items-center justify-center rounded-[7px] text-text-secondary"
          >
            <Plus size={16} />
          </span>
        </div>

        <SearchField
          value={query}
          onChange={setQuery}
          placeholder="Search skills"
          className="mx-3.5 mb-3"
        />

        <SegmentedControl
          options={PANE_FILTERS}
          value={filter}
          onChange={setFilter}
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
                    name={skill.name}
                    description={skill.description}
                    updated={shortDate(skill.updatedAt)}
                    scope={skillScope(skill)}
                    selected={selected?.slug === skill.slug}
                    onSelect={() => setSelectedSlug(skill.slug)}
                  />
                ))}
              </div>
            ))
          )}
        </div>
      </div>

      {/* Detail pane — header comes from the summary row; only the body
          waits on the per-slug fetch. */}
      {selected && (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col antialiased">
          <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border-subtle px-4">
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <span className="truncate text-title font-semibold tracking-tight text-text-primary">
                {selected.name}
              </span>
              {selected.folder && (
                <span className="btn-light flex h-6 shrink-0 items-center gap-1 rounded-md px-2 text-caption text-text-secondary">
                  <Folder size={11} />
                  {selected.folder}
                </span>
              )}
              {selectedScope && SelectedScopeIcon && (
                <span className="flex h-6 shrink-0 items-center gap-1.5 rounded-full border border-border-strong bg-bg-inset px-2.5 text-caption font-medium text-text-secondary">
                  <SelectedScopeIcon size={11} />
                  {SKILL_SCOPE_LABEL[selectedScope]}
                </span>
              )}
            </div>
            <span className="text-small text-text-secondary/60">Saved</span>
            <span className="btn-light flex h-7 items-center gap-1.5 rounded-md px-2.5 text-small font-medium text-text-primary">
              <History size={12} />
              History
            </span>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto w-full max-w-3xl px-6 pb-16 pt-8">
              <SkillBody detail={fresh} error={detail.error} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SkillBody({
  detail,
  error,
}: {
  detail: LiveSkillDetail | null;
  error: boolean;
}) {
  if (!detail) {
    if (error) {
      return (
        <p className="text-caption text-text-muted">
          Couldn&apos;t load this skill right now.
        </p>
      );
    }
    return <SkeletonText lines={6} />;
  }
  const file =
    detail.files.find((f) => f.name === PRIMARY_FILE_NAME) ?? detail.files[0];
  const body = file?.body.trim() ?? "";
  if (!body) {
    return (
      <p className="text-caption text-text-muted">
        This skill has no content yet.
      </p>
    );
  }
  // Member/agent-authored markdown, shown as plain text in the demo's prose
  // recipe (see the typography note in ./skills-pane.tsx). Never HTML.
  return (
    <div className="whitespace-pre-wrap text-[16px] leading-[1.7] text-text-primary/90">
      {body}
    </div>
  );
}

/** One list row — shared with the static demo pane. */
export function SkillRow({
  name,
  description,
  updated,
  scope,
  selected,
  onSelect,
}: {
  name: string;
  description: string;
  updated: string;
  scope: SkillScope;
  selected: boolean;
  onSelect: () => void;
}) {
  const ScopeIcon = SCOPE_ICONS[scope];
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
          {name}
        </span>
        <span className="shrink-0 text-micro text-text-muted">{updated}</span>
      </span>
      <span className="flex w-full items-center gap-1.5 text-caption text-text-secondary">
        <ScopeIcon size={11} className="shrink-0 text-text-muted" />
        <span>{SKILL_SCOPE_LABEL[scope]}</span>
        <span className="text-text-muted">·</span>
        <span className="min-w-0 truncate">{description}</span>
      </span>
    </button>
  );
}
