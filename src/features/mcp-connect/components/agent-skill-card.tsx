"use client";

/**
 * "Teach your agent Dopl" block: one-click copy of the ready-made SKILL.md
 * (skill-template.ts) plus the install path. Local skills load at session boot,
 * so the agent knows the Dopl tools before its first tool call.
 */

import { useEffect, useState } from "react";
import { ArrowUpRight, Check, ChevronRight, Copy, GraduationCap } from "lucide-react";
import { useCopyToClipboard } from "@/shared/hooks/use-copy-to-clipboard";
import { CopyButton } from "@/shared/ui/copy-button";
import { buildDoplSkillMd } from "../skill-template";
import { getAppOrigin } from "@/shared/lib/app-origin";

const SKILLS_DOCS = "https://code.claude.com/docs/en/skills";
const INSTALL_PATH = "~/.claude/skills/dopl/SKILL.md";

export function AgentSkillCard() {
  const [origin, setOrigin] = useState("https://www.usedopl.com");
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOrigin(getAppOrigin());
  }, []);
  const skillMd = buildDoplSkillMd(`${origin}/api/mcp`);

  const { copied, copy } = useCopyToClipboard();
  const [previewOpen, setPreviewOpen] = useState(false);

  return (
    <section className="rounded-xl border border-border-default bg-bg-elevated p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2.5">
          <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-surface-raised-1 text-text-secondary">
            <GraduationCap size={14} />
          </span>
          <div>
            <h3 className="text-title font-medium text-text-primary">
              Teach your agent Dopl
            </h3>
            <p className="mt-0.5 text-small leading-relaxed text-text-tertiary">
              A ready-made skill file your agent loads at session start — it
              learns the Dopl tools, when to use them, and how to ground itself
              in your workspace before its first tool call.
            </p>
          </div>
        </div>
        <a
          href={SKILLS_DOCS}
          target="_blank"
          rel="noreferrer"
          className="flex shrink-0 items-center gap-0.5 text-caption text-text-tertiary hover:text-text-primary transition-colors"
        >
          Skills docs
          <ArrowUpRight size={11} />
        </a>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void copy(skillMd)}
          className="flex items-center gap-1.5 rounded-md bg-surface-cta px-3 py-1.5 text-small font-medium text-text-on-cta hover:bg-surface-cta/90 transition-colors cursor-pointer"
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
          {copied ? "Copied" : "Copy SKILL.md"}
        </button>
        <div className="flex min-w-0 items-center gap-2 rounded-md border border-border-default bg-surface-raised-1 px-3 py-1.5">
          <span className="text-micro font-mono uppercase tracking-wider text-text-secondary/60">
            Save as
          </span>
          <code className="truncate font-mono text-small text-text-secondary">
            {INSTALL_PATH}
          </code>
          <CopyButton text={INSTALL_PATH} size={12} label="Copy install path" />
        </div>
      </div>
      <p className="mt-2 text-caption leading-relaxed text-text-tertiary">
        Claude Code picks up personal skills from{" "}
        <code className="font-mono">~/.claude/skills/</code> automatically
        (use <code className="font-mono">.claude/skills/</code> inside a repo
        to share it with a team). Any agent supporting the Agent Skills
        standard works the same way.
      </p>

      <button
        type="button"
        onClick={() => setPreviewOpen((v) => !v)}
        className="mt-3 flex items-center gap-1 text-caption text-text-tertiary hover:text-text-primary transition-colors cursor-pointer"
        aria-expanded={previewOpen}
      >
        <ChevronRight
          size={11}
          className={`transition-transform ${previewOpen ? "rotate-90" : ""}`}
        />
        {previewOpen ? "Hide file contents" : "Preview file contents"}
      </button>
      {previewOpen && (
        <pre className="mt-2 max-h-72 overflow-y-auto rounded-md border border-border-default bg-surface-raised-1 p-3 font-mono text-caption leading-relaxed text-text-secondary whitespace-pre-wrap">
          {skillMd}
        </pre>
      )}
    </section>
  );
}
