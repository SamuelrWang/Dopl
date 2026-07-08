"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  FileText,
  Plus,
  Search,
  Trash2,
  Zap,
} from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { SegmentedControl } from "@/shared/ui/segmented-control";
import { SectionBox } from "@/shared/ui/section-box";
import { SourceIcon } from "@/shared/ui/source-icon";
import type { SourceProvider } from "@/shared/lib/source-types";
import type { Skill, SkillStatus } from "@/features/skills/types";
import { skillScope, SKILL_SCOPE_LABEL, type SkillScope } from "@/features/skills/scope";
import { skillSegment } from "@/features/skills/url";
import { SKILL_SCOPE_ICONS } from "./skill-share-control";
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

const KNOWN_PROVIDERS = new Set<SourceProvider>([
  "slack",
  "google-drive",
  "gmail",
  "notion",
  "github",
]);

/** Postgres timestamps are full ISO strings; render "Jul 8". */
function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

interface Props {
  workspaceSlug: string;
  workspaceId: string;
  currentUserId: string;
  skills: Skill[];
}

/**
 * Skills index — two-pane .page-float browser matching the chats /
 * knowledge pattern: the scope-filtered list on the left (All / Private
 * / Shared), the selected skill's overview on the right with the CTA
 * into the tabbed editor at /skills/[slug].
 */
export function SkillsBrowser({
  workspaceSlug,
  workspaceId,
  currentUserId,
  skills,
}: Props) {
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

        <div className="concave-field relative mx-3.5 mb-3 rounded-[9px]">
          <Search
            size={15}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted"
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search skills"
            spellCheck={false}
            className="h-9 w-full bg-transparent pl-[33px] pr-3 text-body text-text-primary outline-none placeholder:text-text-muted"
          />
        </div>

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
            visible.map((skill) => (
              <SkillRow
                key={skill.id}
                skill={skill}
                selected={selected?.id === skill.id}
                onSelect={() => setSelectedId(skill.id)}
              />
            ))
          )}
        </div>
      </div>

      {/* Right detail pane */}
      <DetailPane
        skill={selected}
        workspaceSlug={workspaceSlug}
        currentUserId={currentUserId}
        totalSkills={skills.length}
      />

      <SkillsTrashModal
        open={trashOpen}
        onOpenChange={setTrashOpen}
        workspaceId={workspaceId}
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
  const ScopeIcon = SKILL_SCOPE_ICONS[scope];
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

function ScopePill({ skill }: { skill: Skill }) {
  const scope = skillScope(skill);
  const Icon = SKILL_SCOPE_ICONS[scope];
  return (
    <span className="flex h-6 shrink-0 items-center gap-1.5 rounded-full border border-border-strong bg-bg-inset px-2.5 text-caption font-medium text-text-secondary">
      <Icon size={11} />
      {SKILL_SCOPE_LABEL[scope]}
    </span>
  );
}

function DetailPane({
  skill,
  workspaceSlug,
  currentUserId,
  totalSkills,
}: {
  skill: Skill | null;
  workspaceSlug: string;
  currentUserId: string;
  totalSkills: number;
}) {
  if (!skill) {
    return (
      <div className="flex min-w-0 flex-1 flex-col items-center justify-center gap-2.5 px-10 text-text-muted">
        <Zap size={30} className="text-border-strong" />
        {totalSkills === 0 ? (
          <>
            <p className="text-body font-medium text-text-secondary">
              No skills yet.
            </p>
            <p className="max-w-[380px] text-center text-caption leading-relaxed">
              Skills are procedural prompts your connected agent discovers
              over MCP. Ask your agent to create one with{" "}
              <code className="rounded bg-bg-inset px-1">dopl_skill</code>.
            </p>
          </>
        ) : (
          <p className="text-body">Select a skill to read it.</p>
        )}
      </div>
    );
  }

  const isMine = skill.createdBy === currentUserId;

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="flex h-[52px] shrink-0 items-center gap-2 border-b border-border-default px-3.5">
        <span className="min-w-0 truncate text-lead font-semibold text-text-primary">
          {skill.name}
        </span>
        <StatusChip status={skill.status} />
        <span className="flex-1" />
        <ScopePill skill={skill} />
        <Link
          href={`/${workspaceSlug}/skills/${skillSegment(skill)}`}
          className="btn-light flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-md px-2.5 text-small font-medium text-text-primary"
        >
          <FileText size={12} />
          Open skill
          <ArrowUpRight size={12} className="text-text-muted" />
        </Link>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-14 pb-16 pt-8">
        <div className="mx-auto flex max-w-[760px] flex-col gap-5">
          <SectionBox label="Description">
            <p className="px-4 py-3.5 text-lead leading-relaxed text-text-primary">
              {skill.description || "No description yet."}
            </p>
          </SectionBox>

          <SectionBox label="Triggers">
            <div className="flex flex-col gap-3 px-4 py-3.5">
              <div>
                <p className="mb-1 text-label font-semibold uppercase tracking-wide text-text-secondary">
                  When to use
                </p>
                <p className="text-lead leading-relaxed text-text-primary">
                  {skill.whenToUse}
                </p>
              </div>
              {skill.whenNotToUse && (
                <div>
                  <p className="mb-1 text-label font-semibold uppercase tracking-wide text-text-secondary">
                    When NOT to use
                  </p>
                  <p className="text-lead leading-relaxed text-text-primary">
                    {skill.whenNotToUse}
                  </p>
                </div>
              )}
            </div>
          </SectionBox>

          {skill.connectors.length > 0 && (
            <SectionBox
              label="Connectors"
              meta={`${skill.connectors.length}`}
            >
              <div className="flex flex-wrap gap-2 px-4 py-3.5">
                {skill.connectors.map((c) => (
                  <span
                    key={c.provider}
                    title={c.usedFor}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-caption",
                      c.status === "connected"
                        ? "border-border-strong bg-bg-elevated text-text-primary"
                        : "border-border-subtle bg-surface-raised-1 text-text-secondary"
                    )}
                  >
                    {KNOWN_PROVIDERS.has(c.provider) && (
                      <SourceIcon
                        provider={c.provider as SourceProvider}
                        size="sm"
                      />
                    )}
                    <span>{c.name}</span>
                    {c.status === "available" && (
                      <span className="text-micro text-text-muted">
                        Not connected
                      </span>
                    )}
                  </span>
                ))}
              </div>
            </SectionBox>
          )}

          <p className="px-1 text-caption text-text-muted">
            Updated {shortDate(skill.updatedAt)} · slug{" "}
            <code className="rounded bg-bg-inset px-1">{skill.slug}</code>
            {isMine ? " · created by you" : ""} · agent write{" "}
            {skill.agentWriteEnabled ? "on" : "off"}
          </p>
        </div>
      </div>
    </div>
  );
}
