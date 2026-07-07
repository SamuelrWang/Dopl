"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, ChevronRight, Plus, Trash2 } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { SourceIcon } from "@/shared/ui/source-icon";
import type { SourceProvider } from "@/shared/lib/source-types";
import type { Skill, SkillStatus } from "@/features/skills/types";
import { skillSegment } from "@/features/skills/url";
import { SkillsTrashModal } from "./skills-trash-modal";

interface Props {
  workspaceSlug: string;
  workspaceId: string;
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
 * Skills index — one .page-float surface: compact header bar (title,
 * count, trash) over the expandable library rows. Each row expands
 * inline to reveal whenToUse / whenNotToUse / connectors and the CTA
 * into the detail page.
 */
export function SkillsList({ workspaceSlug, workspaceId, skills }: Props) {
  const [trashOpen, setTrashOpen] = useState(false);
  return (
    <div className="page-float flex flex-col antialiased">
      <div className="flex h-11 shrink-0 items-center gap-3 border-b border-border-subtle px-4">
        <h1 className="shrink-0 text-title font-semibold tracking-tight text-text-primary">
          Skills
        </h1>
        <span className="min-w-0 flex-1 truncate text-caption text-text-muted">
          {skills.length} {skills.length === 1 ? "skill" : "skills"} — procedural
          prompts your agent discovers over MCP
        </span>
        <button
          type="button"
          onClick={() => setTrashOpen(true)}
          title="View recently deleted skills"
          className="btn-light flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-md px-2.5 text-small font-medium text-text-primary"
        >
          <Trash2 size={12} />
          Trash
        </button>
        <button
          type="button"
          disabled
          title="Skill authoring lands in the next milestone"
          className="flex h-7 shrink-0 cursor-not-allowed items-center gap-1.5 rounded-md bg-surface-raised-3 px-2.5 text-small font-medium text-text-muted"
        >
          <Plus size={12} />
          New skill
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 pt-4 pb-10">
        <div className="mx-auto max-w-5xl">
          {skills.length === 0 ? (
            <EmptyState />
          ) : (
            <div className="overflow-hidden rounded-xl border border-border-subtle divide-y divide-border-subtle">
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
      </div>

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
    <div className={cn("transition-colors", expanded ? "bg-bg-elevated" : "hover:bg-surface-raised-1")}>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full cursor-pointer items-start gap-3 px-4 py-3 text-left"
        aria-expanded={expanded}
      >
        <ChevronRight
          size={14}
          className={cn(
            "mt-0.5 shrink-0 text-text-muted transition-transform",
            expanded && "rotate-90"
          )}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-body font-semibold text-text-primary">
              {skill.name}
            </p>
            <StatusPill status={skill.status} />
          </div>
          <p className="mt-1 line-clamp-1 text-caption leading-relaxed text-text-secondary">
            {skill.description}
          </p>
        </div>
        {connectedConnectors.length > 0 && (
          <span className="hidden shrink-0 items-center gap-1 sm:flex">
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
      </button>
      {expanded && <ExpandedDetail skill={skill} workspaceSlug={workspaceSlug} />}
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
    <div className="grid grid-cols-1 gap-4 px-9 pb-4 pt-1 lg:grid-cols-2">
      <DetailField label="When to use" value={skill.whenToUse} />
      {skill.whenNotToUse && (
        <DetailField label="When NOT to use" value={skill.whenNotToUse} />
      )}
      {skill.connectors.length > 0 && (
        <div className="lg:col-span-2">
          <p className="mb-2 text-label font-semibold uppercase tracking-wide text-text-secondary">
            Connectors
          </p>
          <div className="flex flex-wrap gap-2">
            {skill.connectors.map((c) => (
              <span
                key={c.provider}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-caption",
                  c.status === "connected"
                    ? "border-border-strong bg-bg-inset text-text-primary"
                    : "border-border-subtle bg-surface-raised-1 text-text-secondary"
                )}
              >
                {KNOWN_PROVIDERS.has(c.provider) && (
                  <SourceIcon provider={c.provider as SourceProvider} size="sm" />
                )}
                <span>{c.name}</span>
                {c.status === "available" && (
                  <span className="text-micro text-text-muted">Not connected</span>
                )}
              </span>
            ))}
          </div>
        </div>
      )}
      <div className="flex justify-end lg:col-span-2">
        <Link
          href={`/${workspaceSlug}/skills/${skillSegment(skill)}`}
          className="inline-flex cursor-pointer items-center gap-1.5 rounded-md bg-surface-cta px-3 py-1.5 text-small font-medium text-text-on-cta transition-opacity hover:opacity-90"
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
      <p className="mb-1 text-label font-semibold uppercase tracking-wide text-text-secondary">
        {label}
      </p>
      <p className="text-body leading-relaxed text-text-primary">{value}</p>
    </div>
  );
}

function StatusPill({ status }: { status: SkillStatus }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded border px-1.5 py-0.5 text-label uppercase tracking-wider",
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

function EmptyState() {
  return (
    <div className="rounded-xl border border-border-subtle p-10 text-center">
      <p className="mb-1 text-body font-medium text-text-primary">No skills yet</p>
      <p className="mx-auto max-w-md text-caption leading-relaxed text-text-secondary">
        Skills are workspace-scoped procedural prompts your connected agent can
        discover and follow. Ask your agent to create one with{" "}
        <code className="rounded bg-bg-inset px-1">dopl_skill</code>.
      </p>
    </div>
  );
}
