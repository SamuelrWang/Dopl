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
      <header className="flex items-center justify-between border-b border-white/[0.06] px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-md border border-white/[0.08] bg-white/[0.04]">
            <Sparkles size={14} className="text-white/70" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-white/90">Skills</h2>
            <p className="text-[11px] text-white/50">
              Click a skill to open it in a panel
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setCreating((c) => !c)}
          className="inline-flex items-center gap-1.5 rounded-md border border-white/[0.12] bg-white/[0.04] px-3 py-1.5 text-xs text-white/80 transition-colors hover:border-white/[0.22] hover:bg-white/[0.08]"
        >
          <Plus size={12} />
          New skill
        </button>
      </header>

      {creating && (
        <form
          onSubmit={handleCreate}
          className="flex items-center gap-2 border-b border-white/[0.06] bg-white/[0.02] px-5 py-3"
        >
          <input
            autoFocus
            type="text"
            value={createName}
            onChange={(e) => setCreateName(e.target.value)}
            placeholder="Skill name"
            className="flex-1 rounded-md border border-white/[0.1] bg-transparent px-3 py-1.5 text-xs text-white/90 placeholder:text-white/30 focus:border-white/[0.25] focus:outline-none"
          />
          <button
            type="submit"
            disabled={!createName.trim()}
            className="rounded-md border border-white/[0.18] bg-white/[0.08] px-3 py-1.5 text-xs text-white/90 transition-colors hover:bg-white/[0.12] disabled:opacity-40"
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
            className="rounded-md px-2 py-1.5 text-xs text-white/50 hover:text-white/85"
          >
            Cancel
          </button>
          {createError && (
            <span className="text-[10px] text-red-400">{createError}</span>
          )}
        </form>
      )}

      <div className="flex-1 overflow-y-auto px-5 py-3">
        {status === "loading" && !skills && (
          <div className="text-xs text-white/40">Loading…</div>
        )}
        {status === "error" && (
          <div className="text-xs text-red-400">
            {error?.message || "Failed to load skills"}
          </div>
        )}
        {skills && skills.length === 0 && (
          <div className="rounded-lg border border-dashed border-white/[0.12] p-8 text-center text-xs text-white/45">
            No skills yet. Click <strong>+ New skill</strong> to add one.
          </div>
        )}
        {skills && skills.length > 0 && (
          <ul className="divide-y divide-white/[0.04]">
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

function SkillRow({ skill, onClick }: { skill: Skill; onClick: () => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className="group w-full cursor-pointer py-3 text-left transition-colors hover:bg-white/[0.02]"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="mb-1 flex items-center gap-2">
              <span className="font-mono text-[12.5px] text-white/90">
                {skill.name}
              </span>
              <StatusPill status={skill.status} />
            </div>
            {skill.description && (
              <p className="mb-2 text-xs leading-relaxed text-white/65">
                {skill.description}
              </p>
            )}
            {skill.whenToUse && (
              <div className="mb-2 text-[11px] leading-relaxed text-white/45">
                <span className="mr-1.5 font-mono uppercase tracking-wider text-white/35">
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
            <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-white/40">
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
    <span className="inline-flex items-center gap-1 rounded-full border border-white/[0.08] bg-white/[0.02] px-1.5 py-0.5 text-[10px] text-white/40">
      <span className="h-1 w-1 rounded-full bg-white/40" />
      draft
    </span>
  );
}

function ConnectorChip({ name }: { name: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-white/[0.08] bg-white/[0.02] px-1.5 py-0.5 text-[10px] text-white/55">
      <Plug size={9} />
      {name}
    </span>
  );
}
