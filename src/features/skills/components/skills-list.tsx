"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  ChevronRight,
  Plus,
  Sparkles,
} from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { PageTopBar } from "@/shared/layout/page-top-bar";
import { SourceIcon } from "@/features/knowledge/components/source-icon";
import type { SourceProvider } from "@/features/knowledge/source-types";
import type { Skill, SkillStatus } from "@/features/skills/types";

interface Props {
  workspaceSlug: string;
  skills: Skill[];
}

const KNOWN_PROVIDERS = new Set<SourceProvider>([
  "slack",
  "google-drive",
  "gmail",
  "notion",
  "github",
]);

/**
 * Skills index — library-card row layout.
 *
 * Each row is collapsed by default. Clicking expands inline to reveal
 * `whenToUse`, `whenNotToUse`, KB sources, connectors, and a CTA into
 * the full detail page. Multi-expand is allowed; state is ephemeral
 * per visit (no URL).
 */
export function SkillsList({ workspaceSlug, skills }: Props) {
  return (
    <>
      <PageTopBar
        title="Skills"
        trailing={
          <button
            type="button"
            disabled
            title="Skill authoring lands in the next milestone"
            className="shrink-0 flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-white/40 text-black/60 text-xs font-medium cursor-not-allowed"
          >
            <Plus size={12} />
            New skill
          </button>
        }
      />
      <div className="container mx-auto max-w-5xl px-6 pt-[68px] pb-8 pointer-events-auto">
        {skills.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="rounded-xl border border-white/[0.06] divide-y divide-white/[0.04] overflow-hidden">
            {skills.map((skill) => (
              <SkillRow
                key={skill.slug}
                skill={skill}
                workspaceSlug={workspaceSlug}
              />
            ))}
          </div>
        )}
      </div>
    </>
  );
}

function SkillRow({
  skill,
  workspaceSlug,
}: {
  skill: Skill;
  workspaceSlug: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const connectedConnectors = skill.connectors.filter(
    (c) => c.status === "connected"
  );

  return (
    <div
      className="bg-transparent hover:bg-white/[0.015] transition-colors"
      style={!expanded ? { backgroundColor: "transparent" } : { backgroundColor: "oklch(0.13 0 0)" }}
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-start gap-3 px-4 py-3 text-left cursor-pointer"
        aria-expanded={expanded}
      >
        <ChevronRight
          size={14}
          className={cn(
            "mt-0.5 text-text-secondary/60 shrink-0 transition-transform",
            expanded && "rotate-90"
          )}
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium text-text-primary truncate">
              {skill.name}
            </p>
            <StatusPill status={skill.status} />
          </div>
          <p className="mt-1 text-xs text-text-secondary line-clamp-1 leading-relaxed">
            {skill.description}
          </p>
        </div>
        <div className="shrink-0 hidden sm:flex items-center gap-3 text-[10px] font-mono uppercase tracking-wider text-text-secondary/60">
          <span className="flex items-center gap-1">
            <Sparkles size={10} />
            {skill.totalInvocations}
          </span>
          {connectedConnectors.length > 0 && (
            <span className="flex items-center gap-1">
              {connectedConnectors.slice(0, 3).map((c) =>
                KNOWN_PROVIDERS.has(c.provider) ? (
                  <SourceIcon
                    key={c.provider}
                    provider={c.provider as SourceProvider}
                    size="sm"
                  />
                ) : null
              )}
            </span>
          )}
        </div>
      </button>
      {expanded && (
        <ExpandedDetail skill={skill} workspaceSlug={workspaceSlug} />
      )}
    </div>
  );
}

function ExpandedDetail({
  skill,
  workspaceSlug,
}: {
  skill: Skill;
  workspaceSlug: string;
}) {
  return (
    <div className="px-9 pb-4 pt-1 grid gap-4 grid-cols-1 lg:grid-cols-2">
      <DetailField label="When to use" value={skill.whenToUse} />
      {skill.whenNotToUse && (
        <DetailField label="When NOT to use" value={skill.whenNotToUse} />
      )}
      {skill.connectors.length > 0 && (
        <div className="lg:col-span-2">
          <p className="text-[10px] font-mono uppercase tracking-wider text-text-secondary/60 mb-2">
            Connectors
          </p>
          <div className="flex flex-wrap gap-2">
            {skill.connectors.map((c) => (
              <span
                key={c.provider}
                className={cn(
                  "inline-flex items-center gap-1.5 px-2 py-1 rounded-md border text-[11px]",
                  c.status === "connected"
                    ? "border-emerald-500/20 bg-emerald-500/5 text-text-primary"
                    : "border-white/[0.06] bg-white/[0.02] text-text-secondary"
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
                  <span className="text-[10px] font-mono uppercase tracking-wider text-text-secondary/60">
                    Not connected
                  </span>
                )}
              </span>
            ))}
          </div>
        </div>
      )}
      <div className="lg:col-span-2 flex justify-end">
        <Link
          href={`/${workspaceSlug}/skills/${skill.slug}`}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-white text-black text-xs font-medium hover:bg-white/90 transition-colors cursor-pointer"
        >
          Open
          <ArrowRight size={12} />
        </Link>
      </div>
    </div>
  );
}

function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] font-mono uppercase tracking-wider text-text-secondary/60 mb-1">
        {label}
      </p>
      <p className="text-sm text-text-primary/90 leading-relaxed">{value}</p>
    </div>
  );
}

function StatusPill({ status }: { status: SkillStatus }) {
  return (
    <span
      className={cn(
        "shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono uppercase tracking-wider",
        status === "active"
          ? "bg-emerald-500/10 text-emerald-300 border border-emerald-500/20"
          : "bg-white/[0.04] text-text-secondary border border-white/[0.08]"
      )}
    >
      <span
        className={cn(
          "w-1 h-1 rounded-full",
          status === "active" ? "bg-emerald-400" : "bg-text-secondary/60"
        )}
      />
      {status}
    </span>
  );
}

function EmptyState() {
  return (
    <div className="rounded-xl border border-white/[0.06] p-10 text-center">
      <p className="text-sm text-text-primary mb-1">No skills yet</p>
      <p className="text-xs text-text-secondary leading-relaxed max-w-md mx-auto">
        Skills are workspace-scoped procedural prompts your connected agent can
        discover and follow. Authoring lands in the next milestone — until then
        new workspaces seed a starter set.
      </p>
    </div>
  );
}
