"use client";

import Link from "next/link";
import { BookOpen, Plus, Sparkles } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { PageTopBar } from "@/shared/layout/page-top-bar";
import { findKnowledgeBase } from "@/features/knowledge/data";
import { SourceIcon } from "@/features/knowledge/components/source-icon";
import { HARDCODED_SKILLS } from "../data";
import type { Skill, SkillStatus } from "../data";

interface Props {
  workspaceSlug: string;
}

/**
 * Index page for `/[workspaceSlug]/skills` — all skills in the
 * workspace, exposed to a connected agent as MCP tools. Hardcoded for
 * now; the agent-side runtime is a separate slice.
 */
export function SkillsList({ workspaceSlug }: Props) {
  return (
    <>
      <PageTopBar
        title="Skills"
        trailing={
          <button
            type="button"
            className="shrink-0 flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-white text-black text-xs font-medium hover:bg-white/90 transition-colors cursor-pointer"
          >
            <Plus size={12} />
            New skill
          </button>
        }
      />
      <div className="container mx-auto max-w-7xl px-6 pt-[68px] pb-8 pointer-events-auto">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {HARDCODED_SKILLS.map((skill) => (
            <SkillCard
              key={skill.slug}
              skill={skill}
              workspaceSlug={workspaceSlug}
            />
          ))}
        </div>
      </div>
    </>
  );
}

function SkillCard({ skill, workspaceSlug }: { skill: Skill; workspaceSlug: string }) {
  const connectedConnectors = skill.connectors.filter(
    (c) => c.status === "connected",
  );
  return (
    <Link
      href={`/${workspaceSlug}/skills/${skill.slug}`}
      className="group flex flex-col rounded-xl border border-white/[0.06] p-5 hover:border-white/[0.15] hover:bg-white/[0.02] transition-colors cursor-pointer"
      style={{ backgroundColor: "oklch(0.13 0 0)" }}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-semibold text-text-primary leading-snug">
          {skill.name}
        </p>
        <StatusPill status={skill.status} />
      </div>

      <p className="mt-2 text-xs text-text-secondary line-clamp-2 leading-relaxed">
        {skill.description}
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-1.5">
        {skill.knowledgeSources.slice(0, 2).map((slug) => {
          const kb = findKnowledgeBase(slug);
          return (
            <span
              key={slug}
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-violet-500/10 border border-violet-500/20 text-[10.5px] text-violet-300 font-medium"
            >
              <BookOpen size={9} />
              {kb?.name ?? slug}
            </span>
          );
        })}
        {skill.knowledgeSources.length > 2 && (
          <span className="text-[10px] text-text-secondary/60 font-mono">
            +{skill.knowledgeSources.length - 2}
          </span>
        )}
        {connectedConnectors.slice(0, 3).map((c) => (
          <span
            key={c.provider}
            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-white/[0.04] border border-white/[0.08]"
            title={c.name}
          >
            <SourceIcon provider={c.provider} size="sm" />
          </span>
        ))}
      </div>

      <div className="mt-4 pt-3 border-t border-white/[0.04] flex items-center justify-between text-[10px] font-mono uppercase tracking-wider text-text-secondary/60">
        <span className="flex items-center gap-1">
          <Sparkles size={10} />
          {skill.totalInvocations} runs
        </span>
        <span>Updated {skill.updatedAt}</span>
      </div>
    </Link>
  );
}

function StatusPill({ status }: { status: SkillStatus }) {
  return (
    <span
      className={cn(
        "shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono uppercase tracking-wider",
        status === "active"
          ? "bg-emerald-500/10 text-emerald-300 border border-emerald-500/20"
          : "bg-white/[0.04] text-text-secondary border border-white/[0.08]",
      )}
    >
      <span
        className={cn(
          "w-1 h-1 rounded-full",
          status === "active" ? "bg-emerald-400" : "bg-text-secondary/60",
        )}
      />
      {status}
    </span>
  );
}
