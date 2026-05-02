"use client";

import { BookOpen, Sparkles } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import {
  KNOWLEDGE_BASES,
  SKILLS,
  type AccessGrant,
  type AccessLevel,
} from "../data";

/**
 * Per-member / per-team access matrix. Two columns side-by-side —
 * knowledge bases on the left, skills on the right. Each row shows
 * the resource name + a None / Read / Edit segmented control.
 *
 * `inheritFrom` is rendered as a subtle hint when a member's grants
 * come from their team's defaults rather than overrides.
 */
export function AccessMatrix({
  knowledgeAccess,
  skillAccess,
  inheritFrom,
}: {
  knowledgeAccess: AccessGrant[];
  skillAccess: AccessGrant[];
  inheritFrom: string | null;
}) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
      <AccessColumn
        title="Knowledge bases"
        icon={<BookOpen size={11} className="text-violet-300/80" />}
        items={KNOWLEDGE_BASES.map((kb) => ({
          slug: kb.slug,
          name: kb.name,
          level: levelFor(knowledgeAccess, kb.slug),
        }))}
        inheritFrom={inheritFrom}
      />
      <AccessColumn
        title="Skills"
        icon={<Sparkles size={11} className="text-amber-300/80" />}
        items={SKILLS.map((s) => ({
          slug: s.slug,
          name: s.name,
          level: levelFor(skillAccess, s.slug),
        }))}
        inheritFrom={inheritFrom}
      />
    </div>
  );
}

function AccessColumn({
  title,
  icon,
  items,
  inheritFrom,
}: {
  title: string;
  icon: React.ReactNode;
  items: { slug: string; name: string; level: AccessLevel }[];
  inheritFrom: string | null;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-mono uppercase tracking-wider text-text-secondary/70">
          {title}
        </span>
        {inheritFrom && (
          <span className="text-[10px] font-mono text-text-secondary/40">
            inherits from {inheritFrom}
          </span>
        )}
      </div>
      <div className="rounded-lg border border-white/[0.06] divide-y divide-white/[0.04] overflow-hidden">
        {items.map((it) => (
          <div
            key={it.slug}
            className="flex items-center justify-between gap-3 px-3 py-2"
          >
            <div className="flex items-center gap-2 min-w-0">
              {icon}
              <span className="text-[13px] text-text-primary/90 truncate">
                {it.name}
              </span>
            </div>
            <AccessSegmented value={it.level} />
          </div>
        ))}
      </div>
    </div>
  );
}

function AccessSegmented({ value }: { value: AccessLevel }) {
  const options: Array<{ key: AccessLevel; label: string }> = [
    { key: "none", label: "None" },
    { key: "read", label: "Read" },
    { key: "edit", label: "Edit" },
  ];
  return (
    <div className="flex items-center bg-white/[0.03] border border-white/[0.06] rounded-md p-0.5">
      {options.map((opt) => {
        const active = opt.key === value;
        return (
          <button
            key={opt.key}
            type="button"
            className={cn(
              "px-2 py-0.5 text-[11px] font-medium rounded transition-colors cursor-pointer",
              active
                ? opt.key === "edit"
                  ? "bg-emerald-500/15 text-emerald-200"
                  : opt.key === "read"
                    ? "bg-violet-500/15 text-violet-200"
                    : "bg-white/[0.06] text-text-secondary"
                : "text-text-secondary/50 hover:text-text-secondary"
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

function levelFor(grants: AccessGrant[], slug: string): AccessLevel {
  return grants.find((g) => g.slug === slug)?.level ?? "none";
}
