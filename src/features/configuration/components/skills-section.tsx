"use client";

import { useState } from "react";
import { Activity, Clock, Package, Plus, Sparkles } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import type { ProfileSkill } from "../types";
import { MockSwitch, SectionPanel } from "./config-bits";

/**
 * Manager skills section — card grid with per-skill usage stats, source,
 * workflow tags, and an enable switch. Toggles flip local state only.
 */
export function SkillsSection({ skills: initial }: { skills: ProfileSkill[] }) {
  const [skills, setSkills] = useState(initial);
  const onCount = skills.filter((s) => s.enabled).length;

  return (
    <SectionPanel
      label="Skills"
      meta={`${onCount} of ${skills.length} enabled`}
      action={
        <button
          type="button"
          className="btn-light flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium text-text-primary"
        >
          <Plus size={12} /> Add skill
        </button>
      }
      flush
    >
      <div className="grid grid-cols-1 gap-3 border-t border-black/[0.06] p-3.5 md:grid-cols-2">
        {skills.map((s, i) => (
          <div
            key={s.id}
            className={cn(
              "flex flex-col gap-2 rounded-xl border border-black/[0.1] p-3.5 shadow-[0_1px_2px_rgba(0,0,0,0.03)] transition-opacity",
              !s.enabled && "opacity-60"
            )}
          >
            <div className="flex items-start gap-2.5">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#1c2127] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_1px_2px_rgba(0,0,0,0.15)]">
                <Sparkles size={14} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[13.5px] font-semibold leading-tight text-text-primary">
                  {s.name}
                </div>
                <div className="mt-0.5 flex items-center gap-1 text-[11px] text-text-muted">
                  <Package size={10} /> {s.source}
                </div>
              </div>
              <MockSwitch
                on={s.enabled}
                label={`Toggle ${s.name}`}
                onToggle={() =>
                  setSkills((prev) =>
                    prev.map((p, j) =>
                      j === i ? { ...p, enabled: !p.enabled } : p
                    )
                  )
                }
              />
            </div>
            <p className="text-xs leading-relaxed text-text-secondary">
              {s.description}
            </p>
            <div className="mt-auto flex items-center gap-2 pt-1">
              {s.tags.map((t) => (
                <span
                  key={t}
                  className="rounded-full bg-bg-inset px-2 py-0.5 text-[10.5px] font-medium text-text-secondary"
                >
                  {t}
                </span>
              ))}
              <span className="flex-1" />
              <span className="flex items-center gap-1 text-[10.5px] text-text-muted">
                <Activity size={10} /> {s.runsPerWeek}/wk
              </span>
              <span className="flex items-center gap-1 text-[10.5px] text-text-muted">
                <Clock size={10} /> {s.lastUsed}
              </span>
            </div>
          </div>
        ))}
      </div>
    </SectionPanel>
  );
}
