"use client";

import { useState } from "react";
import { Check, ChevronRight, Plus, Sparkles } from "lucide-react";

import { cn } from "@/shared/lib/utils";

import { SKILLS, type SkillEntry } from "../constants";
import { PageTopBar } from "./page-top-bar";

export function SkillsMock() {
  return (
    <div
      className="flex flex-col h-full"
      style={{ backgroundColor: "oklch(0.11 0 0)" }}
    >
      <PageTopBar
        title="Skills"
        right={
          <button
            type="button"
            className="inline-flex items-center gap-1.5 text-[12px] text-white/40 px-2.5 py-1 rounded-md border border-white/[0.06] cursor-not-allowed"
          >
            <Plus size={12} /> New skill
          </button>
        }
      />
      <div className="flex-1 overflow-y-auto px-8 py-6">
        <div className="max-w-5xl mx-auto rounded-xl border border-white/[0.08] divide-y divide-white/[0.04] bg-white/[0.01]">
          {SKILLS.map((s) => (
            <SkillRow key={s.name} skill={s} initialOpen={!!s.expanded} />
          ))}
        </div>
      </div>
    </div>
  );
}

function SkillRow({
  skill,
  initialOpen,
}: {
  skill: SkillEntry;
  initialOpen: boolean;
}) {
  const [open, setOpen] = useState(initialOpen);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-start gap-3 px-5 py-3.5 hover:bg-white/[0.02] text-left"
      >
        <ChevronRight
          size={14}
          className={cn(
            "mt-1 text-white/40 shrink-0 transition-transform",
            open && "rotate-90",
          )}
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-medium text-white">
              {skill.name}
            </span>
            <span className="inline-flex items-center gap-1 text-[10px] text-emerald-300 px-1.5 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20">
              <span className="w-1 h-1 rounded-full bg-emerald-400" /> active
            </span>
          </div>
          <p
            className="text-[12px] text-white/50 mt-0.5 line-clamp-1"
            dangerouslySetInnerHTML={{ __html: skill.desc }}
          />
        </div>
        <div className="flex items-center gap-3 shrink-0 mt-0.5">
          <span className="inline-flex items-center gap-1 text-[11px] text-white/60 font-mono">
            <Sparkles size={11} className="text-amber-400/70" />{" "}
            {skill.invocations.toLocaleString()}
          </span>
          <div className="flex -space-x-1">
            {skill.connectors.map((c) => (
              <ConnectorIcon key={c} name={c} />
            ))}
          </div>
        </div>
      </button>
      {open && skill.whenUse && (
        <div className="px-5 pb-5 pt-1 grid grid-cols-1 md:grid-cols-2 gap-5 bg-white/[0.01]">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-white/40 mb-1.5">
              When to use
            </div>
            <p className="text-[12px] text-white/70 leading-relaxed">
              {skill.whenUse}
            </p>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-white/40 mb-1.5">
              When NOT to use
            </div>
            <p className="text-[12px] text-white/70 leading-relaxed">
              {skill.whenNot}
            </p>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-white/40 mb-1.5">
              Connectors
            </div>
            <div className="flex flex-wrap gap-1.5">
              {(skill.connectorBadges ?? []).map((b) =>
                b.connected ? (
                  <span
                    key={b.name}
                    className="inline-flex items-center gap-1 text-[11px] text-emerald-300 px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20"
                  >
                    {b.name} <Check size={10} />
                  </span>
                ) : (
                  <span
                    key={b.name}
                    className="inline-flex items-center gap-1 text-[11px] text-white/50 px-2 py-0.5 rounded-full bg-white/[0.02] border border-white/[0.06]"
                  >
                    {b.name}
                  </span>
                ),
              )}
            </div>
          </div>
          <div className="flex items-end justify-end">
            <button
              type="button"
              className="bg-white text-black text-[12px] font-medium px-3 py-1.5 rounded-md"
            >
              Open
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ConnectorIcon({ name }: { name: string }) {
  const map: Record<string, { bg: string; ch: string; fg?: string }> = {
    linkedin: { bg: "bg-[#0A66C2]", ch: "in" },
    gmail: { bg: "bg-[#EA4335]", ch: "M" },
    polymarket: { bg: "bg-[#1652F0]", ch: "P" },
    github: { bg: "bg-[#0d1117]", ch: "G" },
    linear: { bg: "bg-[#5E6AD2]", ch: "L" },
    slack: { bg: "bg-[#4A154B]", ch: "S" },
    notion: { bg: "bg-white", ch: "N", fg: "text-black" },
  };
  const m = map[name] ?? { bg: "bg-white/[0.1]", ch: "?" };
  return (
    <div
      className={cn(
        "w-5 h-5 rounded-full ring-2 ring-[oklch(0.11_0_0)] flex items-center justify-center text-[8px] font-semibold",
        m.bg,
        m.fg ?? "text-white",
      )}
    >
      {m.ch}
    </div>
  );
}
