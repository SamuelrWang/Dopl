"use client";

import { useState } from "react";
import { Plug, Plus, Sparkles, Play } from "lucide-react";
import {
  findNonOverlappingPosition,
  nextPanelIdString,
  useCanvas,
  useCanvasScope,
} from "../../canvas-store";
import { SKILL_PANEL_SIZE, type SkillsPanelData } from "../../types";
import { useSkills } from "@/features/skills/client/hooks";
import { useSkillsRealtime } from "@/features/skills/client/realtime";
import { createSkill } from "@/features/skills/client/api";
import type { Skill } from "@/features/skills/types";
import { Skeleton } from "@/shared/ui/skeleton";

export function SkillsPanelBody({ panel }: { panel: SkillsPanelData }) {
  const { state, dispatch } = useCanvas();
  const scope = useCanvasScope();
  const { data: skills, status, error, refetch } = useSkills(scope?.workspaceId);
  useSkillsRealtime(scope?.workspaceId, refetch);
  const [creating, setCreating] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);

  function handleSpawnSkill(skill: Skill) {
    const targetX = panel.x + panel.width + 24;
    const targetY = panel.y;
    const { x, y } = findNonOverlappingPosition(
      targetX,
      targetY,
      SKILL_PANEL_SIZE.width,
      SKILL_PANEL_SIZE.height,
      state.panels
    );
    dispatch({
      type: "CREATE_SKILL_PANEL",
      id: nextPanelIdString(state),
      x,
      y,
      skillId: skill.id,
      slug: skill.slug,
      name: skill.name,
      description: skill.description,
      status: skill.status,
    });
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!createName.trim()) return;
    setCreateError(null);
    try {
      const result = await createSkill({
        name: createName.trim(),
        description: "",
        whenToUse: "",
        status: "draft",
      });
      setCreateName("");
      setCreating(false);
      refetch();
      handleSpawnSkill(result.skill);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Failed to create");
    }
  }

  return (
    <div className="flex h-full w-full flex-col">
      <header className="flex items-center justify-between border-b border-border-subtle px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-md border border-border-default bg-surface-raised-2">
            <Sparkles size={14} className="text-text-secondary" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-text-primary">Skills</h2>
            <p className="text-[11px] text-text-tertiary">
              Click a skill to open it in a panel
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setCreating((c) => !c)}
          className="inline-flex items-center gap-1.5 rounded-md border border-border-strong bg-surface-raised-2 px-3 py-1.5 text-xs text-text-secondary transition-colors hover:border-border-highlight hover:bg-surface-raised-4"
        >
          <Plus size={12} />
          New skill
        </button>
      </header>

      {creating && (
        <form
          onSubmit={handleCreate}
          className="flex items-center gap-2 border-b border-border-subtle bg-surface-raised-1 px-5 py-3"
        >
          <input
            autoFocus
            type="text"
            value={createName}
            onChange={(e) => setCreateName(e.target.value)}
            placeholder="Skill name"
            className="flex-1 rounded-md border border-border-default bg-transparent px-3 py-1.5 text-xs text-text-primary placeholder:text-text-muted focus:border-border-highlight focus:outline-none"
          />
          <button
            type="submit"
            disabled={!createName.trim()}
            className="rounded-md border border-border-strong bg-surface-raised-4 px-3 py-1.5 text-xs text-text-primary transition-colors hover:bg-surface-raised-4 disabled:opacity-40"
          >
            Create
          </button>
          <button
            type="button"
            onClick={() => {
              setCreating(false);
              setCreateName("");
              setCreateError(null);
            }}
            className="rounded-md px-2 py-1.5 text-xs text-text-tertiary hover:text-text-secondary"
          >
            Cancel
          </button>
          {createError && (
            <span className="text-[10px] text-red-400">{createError}</span>
          )}
        </form>
      )}

      <div className="flex-1 overflow-y-auto px-5 py-3">
        {status === "loading" && !skills && <SkillRowSkeletonList />}
        {status === "error" && (
          <div className="rounded-lg border border-red-400/20 bg-red-500/5 p-4 text-xs text-red-400">
            {error?.message || "Failed to load skills"}
          </div>
        )}
        {skills && skills.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border-strong px-6 py-12 text-center">
            <Sparkles size={20} className="text-text-muted" />
            <div>
              <div className="text-xs text-text-tertiary">No skills yet</div>
              <div className="mt-1 text-[11px] text-text-muted">
                Click <strong className="text-text-tertiary">+ New skill</strong> to
                add one.
              </div>
            </div>
          </div>
        )}
        {skills && skills.length > 0 && (
          <ul className="divide-y divide-border-subtle">
            {skills.map((skill) => (
              <SkillRow
                key={skill.id}
                skill={skill}
                onClick={() => handleSpawnSkill(skill)}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function SkillRowSkeletonList() {
  return (
    <ul
      className="divide-y divide-border-subtle"
      aria-label="Loading skills"
    >
      {[0, 1, 2].map((i) => (
        <li key={i} className="py-3">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1 space-y-2">
              <div className="flex items-center gap-2">
                <Skeleton className="h-3.5 w-32 bg-surface-raised-3" />
                <Skeleton className="h-3.5 w-12 rounded-full bg-surface-raised-3" />
              </div>
              <Skeleton className="h-3 w-full bg-surface-raised-2" />
              <Skeleton className="h-3 w-3/4 bg-surface-raised-2" />
            </div>
            <Skeleton className="h-3 w-16 bg-surface-raised-2" />
          </div>
        </li>
      ))}
    </ul>
  );
}

function SkillRow({ skill, onClick }: { skill: Skill; onClick: () => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className="group w-full cursor-pointer py-3 text-left transition-colors hover:bg-surface-raised-1"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="mb-1 flex items-center gap-2">
              <span className="font-mono text-[12.5px] text-text-primary">
                {skill.name}
              </span>
              <StatusPill status={skill.status} />
            </div>
            {skill.description && (
              <p className="mb-2 text-xs leading-relaxed text-text-tertiary">
                {skill.description}
              </p>
            )}
            {skill.whenToUse && (
              <div className="mb-2 text-[11px] leading-relaxed text-text-muted">
                <span className="mr-1.5 font-mono uppercase tracking-wider text-text-muted">
                  When to use:
                </span>
                <span className="line-clamp-2">{skill.whenToUse}</span>
              </div>
            )}
            {skill.connectors.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                {skill.connectors.map((c) => (
                  <ConnectorChip key={c.provider} name={c.provider} />
                ))}
              </div>
            )}
          </div>
          <div className="flex shrink-0 flex-col items-end gap-2">
            <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-text-muted">
              <Play size={9} />
              {skill.totalInvocations.toLocaleString()} runs
            </div>
          </div>
        </div>
      </button>
    </li>
  );
}

function StatusPill({ status }: { status: "active" | "draft" }) {
  if (status === "active") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-1.5 py-0.5 text-[10px] text-emerald-300/90">
        <span className="h-1 w-1 rounded-full bg-emerald-400" />
        active
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-border-default bg-surface-raised-1 px-1.5 py-0.5 text-[10px] text-text-muted">
      <span className="h-1 w-1 rounded-full bg-text-text-muted" />
      draft
    </span>
  );
}

function ConnectorChip({ name }: { name: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-border-default bg-surface-raised-1 px-1.5 py-0.5 text-[10px] text-text-tertiary">
      <Plug size={9} />
      {name}
    </span>
  );
}
