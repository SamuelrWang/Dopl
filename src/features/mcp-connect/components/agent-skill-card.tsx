"use client";

/**
 * AgentSkillCard — "teach your agent Dopl" block for the overview page.
 *
 * Offers the ready-made SKILL.md (built by skill-template.ts) as a
 * one-click copy plus the exact install path. Local skills load at
 * session boot, so the agent knows the Dopl tools and the workflow
 * hierarchy semantics before its first tool call — instead of learning
 * them mid-conversation from server instructions alone.
 */

import { useEffect, useState } from "react";
import { ArrowUpRight, Check, ChevronRight, Copy, GraduationCap } from "lucide-react";
import { buildDoplSkillMd } from "../skill-template";

const SKILLS_DOCS = "https://code.claude.com/docs/en/skills";
const INSTALL_PATH = "~/.claude/skills/dopl/SKILL.md";

export function AgentSkillCard() {
  const [origin, setOrigin] = useState("https://www.usedopl.com");
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOrigin(window.location.origin);
  }, []);
  const skillMd = buildDoplSkillMd(`${origin}/api/mcp`);

  const [copied, setCopied] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);

  function copy(text: string, id: string) {
    if (typeof navigator === "undefined" || !navigator.clipboard) return;
    void navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 1500);
  }

  return (
    <section className="rounded-xl border border-border-default bg-[var(--card-surface)] p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2.5">
          <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-surface-raised-1 text-text-secondary">
            <GraduationCap size={14} />
          </span>
          <div>
            <h3 className="text-sm font-medium text-text-primary">
              Teach your agent Dopl
            </h3>
            <p className="mt-0.5 text-[12px] leading-relaxed text-text-tertiary">
              A ready-made skill file your agent loads at session start — it
              learns the Dopl tools, when to use them, and how to follow
              workflow stages before its first tool call.
            </p>
          </div>
        </div>
        <a
          href={SKILLS_DOCS}
          target="_blank"
          rel="noreferrer"
          className="flex shrink-0 items-center gap-0.5 text-[11px] text-text-tertiary hover:text-text-primary transition-colors"
        >
          Skills docs
          <ArrowUpRight size={11} />
        </a>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => copy(skillMd, "skill-md")}
          className="flex items-center gap-1.5 rounded-md bg-surface-cta px-3 py-1.5 text-xs font-medium text-text-on-cta hover:bg-surface-cta/90 transition-colors cursor-pointer"
        >
          {copied === "skill-md" ? <Check size={12} /> : <Copy size={12} />}
          {copied === "skill-md" ? "Copied" : "Copy SKILL.md"}
        </button>
        <div className="flex min-w-0 items-center gap-2 rounded-md border border-border-default bg-surface-raised-1 px-3 py-1.5">
          <span className="text-[10px] font-mono uppercase tracking-wider text-text-secondary/60">
            Save as
          </span>
          <code className="truncate font-mono text-[12px] text-text-secondary">
            {INSTALL_PATH}
          </code>
          <button
            type="button"
            onClick={() => copy(INSTALL_PATH, "skill-path")}
            className="shrink-0 text-text-muted hover:text-text-secondary transition-colors cursor-pointer"
            title="Copy path"
            aria-label="Copy install path"
          >
            {copied === "skill-path" ? (
              <Check className="w-3 h-3" />
            ) : (
              <Copy className="w-3 h-3" />
            )}
          </button>
        </div>
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-text-tertiary">
        Claude Code picks up personal skills from{" "}
        <code className="font-mono">~/.claude/skills/</code> automatically
        (use <code className="font-mono">.claude/skills/</code> inside a repo
        to share it with a team). Any agent supporting the Agent Skills
        standard works the same way.
      </p>

      <button
        type="button"
        onClick={() => setPreviewOpen((v) => !v)}
        className="mt-3 flex items-center gap-1 text-[11px] text-text-tertiary hover:text-text-primary transition-colors cursor-pointer"
        aria-expanded={previewOpen}
      >
        <ChevronRight
          size={11}
          className={`transition-transform ${previewOpen ? "rotate-90" : ""}`}
        />
        {previewOpen ? "Hide file contents" : "Preview file contents"}
      </button>
      {previewOpen && (
        <pre className="mt-2 max-h-72 overflow-y-auto rounded-md border border-border-default bg-surface-raised-1 p-3 font-mono text-[11px] leading-relaxed text-text-secondary whitespace-pre-wrap">
          {skillMd}
        </pre>
      )}
    </section>
  );
}
