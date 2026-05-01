"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Activity as ActivityIcon,
  BookOpen,
  ChevronRight,
  CircleCheck,
  Pencil,
  Play,
  Plug,
  XCircle,
  MoreHorizontal,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { PageTopBar } from "@/shared/layout/page-top-bar";
import { findKnowledgeBase } from "@/features/knowledge/data";
import { SourceIcon } from "@/features/knowledge/components/source-icon";
import type { Skill } from "../data";
import { SkillBodyRender } from "./body-render";

interface Props {
  skill: Skill;
  workspaceSlug: string;
}

type Tab = "editor" | "connectors" | "activity";

const TABS: ReadonlyArray<{ id: Tab; label: string; icon: LucideIcon }> = [
  { id: "editor", label: "Editor", icon: Pencil },
  { id: "connectors", label: "Connectors", icon: Plug },
  { id: "activity", label: "Activity", icon: ActivityIcon },
];

/**
 * Skill detail page. Three tabs: Editor (when-to-use, when-not, body,
 * sources, examples), Connectors (integrations the skill needs),
 * Activity (recent invocation log).
 *
 * Header treatment: thin PageTopBar with skill name in normal text;
 * "Test in Claude Code" lives there as a trailing action. No giant H1,
 * no description, no status pill row — per spec.
 */
export function SkillView({ skill, workspaceSlug }: Props) {
  const [tab, setTab] = useState<Tab>("editor");

  return (
    <>
      <PageTopBar
        title={skill.name}
        trailing={
          <>
            <button
              type="button"
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-white/[0.06] hover:bg-white/[0.04] transition-colors text-xs text-text-primary cursor-pointer"
            >
              <Play size={12} />
              Test in Claude Code
            </button>
            <button
              type="button"
              aria-label="More"
              className="w-7 h-7 rounded-md flex items-center justify-center hover:bg-white/[0.04] transition-colors cursor-pointer"
            >
              <MoreHorizontal size={13} className="text-text-secondary" />
            </button>
          </>
        }
      />
      <div className="container mx-auto max-w-6xl px-6 pt-[68px] pb-8 pointer-events-auto">
        <div className="flex items-center gap-1 border-b border-white/[0.06]">
          {TABS.map((t) => {
            const Icon = t.icon;
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={cn(
                  "relative flex items-center gap-1.5 px-3 py-2 text-sm transition-colors cursor-pointer",
                  active
                    ? "text-text-primary"
                    : "text-text-secondary hover:text-text-primary",
                )}
              >
                <Icon size={13} />
                {t.label}
                {active && (
                  <span className="absolute left-2 right-2 -bottom-px h-px bg-text-primary" />
                )}
              </button>
            );
          })}
        </div>

        <div className="mt-6">
          {tab === "editor" && (
            <EditorTab skill={skill} workspaceSlug={workspaceSlug} />
          )}
          {tab === "connectors" && <ConnectorsTab skill={skill} />}
          {tab === "activity" && <ActivityTab skill={skill} />}
        </div>
      </div>
    </>
  );
}

// ── Editor tab ──────────────────────────────────────────────────────

function EditorTab({ skill, workspaceSlug }: Props) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 auto-rows-min">
      <Card title="When to use" className="lg:col-span-3 lg:row-span-1">
        <p className="text-sm text-text-primary/90 leading-relaxed">
          {skill.whenToUse}
        </p>
      </Card>

      <Card title="When NOT to use" className="lg:col-span-3">
        <p className="text-sm text-text-primary/90 leading-relaxed">
          {skill.whenNotToUse}
        </p>
      </Card>

      <Card
        title="Procedure"
        className="lg:col-span-2 lg:row-span-2"
        action={
          <span className="text-[11px] text-text-secondary/60 font-mono uppercase tracking-wider">
            Markdown · {skill.body.length.toLocaleString()} chars
          </span>
        }
      >
        <SkillBodyRender body={skill.body} workspaceSlug={workspaceSlug} />
      </Card>

      <Card title="Knowledge sources">
        <div className="flex flex-col gap-2">
          {skill.knowledgeSources.map((slug) => {
            const kb = findKnowledgeBase(slug);
            if (!kb) return null;
            return (
              <Link
                key={slug}
                href={`/${workspaceSlug}/knowledge/${slug}`}
                className="flex items-center gap-3 rounded-lg border border-white/[0.06] p-2.5 hover:bg-white/[0.04] hover:border-white/[0.1] transition-colors cursor-pointer group"
              >
                <div className="w-8 h-8 rounded-md flex items-center justify-center bg-violet-500/10 border border-violet-500/20 shrink-0">
                  <BookOpen size={13} className="text-violet-300" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-text-primary leading-tight truncate">
                    {kb.name}
                  </p>
                  <p className="text-[10px] font-mono uppercase tracking-wider text-text-secondary/60">
                    {kb.entries.length} entries
                  </p>
                </div>
                <ChevronRight
                  size={13}
                  className="text-text-secondary/40 group-hover:text-text-secondary shrink-0"
                />
              </Link>
            );
          })}
        </div>
      </Card>

      <Card
        title={`Examples · ${skill.examples.length}`}
        action={
          <button
            type="button"
            className="text-[11px] text-text-secondary hover:text-text-primary transition-colors"
          >
            Add example
          </button>
        }
      >
        <div className="flex flex-col gap-2">
          {skill.examples.map((ex) => (
            <details
              key={ex.id}
              className="group rounded-lg border border-white/[0.06] hover:border-white/[0.1] transition-colors"
            >
              <summary className="flex items-center gap-2 px-3 py-2 cursor-pointer list-none">
                <ChevronRight
                  size={12}
                  className="text-text-secondary/60 group-open:rotate-90 transition-transform shrink-0"
                />
                <p className="text-sm text-text-primary truncate">{ex.title}</p>
              </summary>
              <div className="px-3 pb-3 space-y-2 text-xs">
                <div>
                  <p className="text-[10px] font-mono uppercase tracking-wider text-text-secondary/60 mb-1">
                    Input
                  </p>
                  <p className="text-text-secondary leading-relaxed">{ex.input}</p>
                </div>
                <div>
                  <p className="text-[10px] font-mono uppercase tracking-wider text-text-secondary/60 mb-1">
                    Output
                  </p>
                  <pre className="whitespace-pre-wrap font-sans text-text-primary/90 leading-relaxed">
                    {ex.output}
                  </pre>
                </div>
              </div>
            </details>
          ))}
        </div>
      </Card>
    </div>
  );
}

// ── Connectors tab ──────────────────────────────────────────────────

function ConnectorsTab({ skill }: { skill: Skill }) {
  return (
    <div className="flex flex-col gap-3 max-w-3xl">
      <p className="text-xs text-text-secondary mb-1">
        Connectors this skill calls at runtime. Bindings resolve per-invoker
        — each member who runs this skill uses their own connected accounts.
      </p>
      {skill.connectors.map((c) => (
        <div
          key={c.provider}
          className={cn(
            "rounded-xl border p-4",
            c.status === "connected"
              ? "border-white/[0.1] bg-white/[0.02]"
              : "border-white/[0.05] bg-white/[0.01]",
          )}
        >
          <div className="flex items-start gap-3">
            <SourceIcon provider={c.provider} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <p className="text-sm font-medium text-text-primary">{c.name}</p>
                {c.status === "connected" ? (
                  <span className="flex items-center gap-1 text-[10px] font-mono uppercase tracking-wider text-emerald-300">
                    <span className="w-1 h-1 rounded-full bg-emerald-400" />
                    Connected
                  </span>
                ) : (
                  <span className="text-[10px] font-mono uppercase tracking-wider text-text-secondary/60">
                    Not connected
                  </span>
                )}
              </div>
              <p className="mt-1 text-xs text-text-secondary leading-relaxed">
                <span className="text-text-secondary/60 font-mono uppercase text-[10px] tracking-wider mr-1">
                  Used for
                </span>
                {c.usedFor}
              </p>
              {c.meta && (
                <p className="mt-1 text-[11px] font-mono text-text-secondary/60">
                  {c.meta}
                </p>
              )}
            </div>
            {c.status === "connected" ? (
              <button
                type="button"
                className="text-[11px] text-text-secondary hover:text-text-primary transition-colors px-2 py-1 cursor-pointer shrink-0"
              >
                Manage
              </button>
            ) : (
              <button
                type="button"
                className="text-[11px] px-3 py-1.5 rounded-md bg-white text-black font-medium hover:bg-white/90 transition-colors cursor-pointer shrink-0"
              >
                Connect
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Activity tab ────────────────────────────────────────────────────

function ActivityTab({ skill }: { skill: Skill }) {
  return (
    <div className="max-w-3xl">
      <div className="mb-4 flex items-baseline gap-3 text-xs text-text-secondary">
        <span>
          <span className="text-text-primary font-semibold">
            {skill.totalInvocations}
          </span>{" "}
          total runs
        </span>
        <span>·</span>
        <span>
          <span className="text-text-primary font-semibold">
            {skill.recentRuns.filter((r) => r.status === "success").length}
          </span>{" "}
          successful in last {skill.recentRuns.length}
        </span>
      </div>

      <div className="rounded-xl border border-white/[0.06] divide-y divide-white/[0.04] overflow-hidden">
        {skill.recentRuns.map((run) => (
          <div key={run.id} className="flex items-start gap-3 p-4">
            {run.status === "success" ? (
              <CircleCheck
                size={14}
                className="text-emerald-400 mt-0.5 shrink-0"
              />
            ) : (
              <XCircle size={14} className="text-red-400 mt-0.5 shrink-0" />
            )}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 text-xs">
                <span className="text-text-primary font-medium">
                  {run.invokedBy}
                </span>
                <span className="text-text-secondary/40">·</span>
                <span className="text-text-secondary">{run.invokedAt}</span>
                <span className="text-text-secondary/40">·</span>
                <span className="font-mono text-text-secondary/60">
                  {(run.durationMs / 1000).toFixed(2)}s
                </span>
              </div>
              <p className="mt-1 text-sm text-text-primary/90 leading-relaxed">
                {run.summary}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Card primitive ──────────────────────────────────────────────────

interface CardProps {
  title?: string;
  action?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}

function Card({ title, action, className, children }: CardProps) {
  return (
    <div
      className={cn(
        "rounded-xl border border-white/[0.06] p-4",
        className,
      )}
      style={{ backgroundColor: "oklch(0.13 0 0)" }}
    >
      {(title || action) && (
        <div className="flex items-center justify-between mb-3">
          {title ? (
            <h2 className="text-[10px] font-mono uppercase tracking-wider text-text-secondary/70">
              {title}
            </h2>
          ) : (
            <span />
          )}
          {action}
        </div>
      )}
      {children}
    </div>
  );
}
