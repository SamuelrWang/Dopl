"use client";

import { BookOpen, Sparkles } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { CopyButton } from "@/shared/ui/copy-button";
import { SectionBox } from "@/shared/ui/section-box";
import { CHIP, RAISED_WELL } from "@/shared/ui/wells";
import { AGENT_SETUP_PROMPT } from "../mock-data";
import type { AgentGuide } from "../types";
import { PolicyPill } from "./config-fields";
import { MemberStepCard } from "./member-step-card";

/**
 * Member view — the guide rendered as the checklist a teammate (or
 * their agent) walks through. Progress and done-states are mock.
 */
export function MemberGuide({ guide }: { guide: AgentGuide }) {
  const done = guide.steps.filter((s) => s.sampleDone).length;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-[720px] flex-col gap-4 px-6 py-7">
        <div className="bento p-5">
          <h2 className="text-display font-semibold leading-snug tracking-tight text-text-primary">
            Set up your agent for {guide.teamName}
          </h2>
          <p className="mt-1 text-lead leading-relaxed text-text-secondary">
            {guide.publishedBy} keeps this guide up to date (currently v
            {guide.version}). Finish the steps once — after that your agent
            stays in sync automatically.
          </p>
          <div className="mt-3.5 flex items-center gap-3">
            <div className="concave-field h-2 flex-1 overflow-hidden rounded-full">
              <div
                className="h-full rounded-full bg-text-primary"
                style={{ width: `${(done / guide.steps.length) * 100}%` }}
              />
            </div>
            <span className="text-small font-semibold text-text-secondary">
              {done} of {guide.steps.length} done
            </span>
          </div>
        </div>

        <SectionBox label="Fastest path" meta="let your agent set itself up">
          <div className="flex flex-col gap-2.5 p-3">
            <p className="text-body leading-relaxed text-text-primary">
              Already have an agent (Claude Code, Cursor, anything
              MCP-capable)? Paste this prompt and it will connect to Dopl,
              read this guide, and walk you through the rest.
            </p>
            <div className={cn(RAISED_WELL, "relative")}>
              <p className="p-2.5 pr-9 font-mono text-small leading-relaxed text-text-secondary">
                {AGENT_SETUP_PROMPT}
              </p>
              <span className="absolute right-2 top-2">
                <CopyButton
                  text={AGENT_SETUP_PROMPT}
                  size={13}
                  label="Copy setup prompt"
                />
              </span>
            </div>
          </div>
        </SectionBox>

        <div className="flex flex-col gap-2">
          {guide.steps.map((step, i) => (
            <MemberStepCard key={step.id} step={step} stepNumber={i + 1} />
          ))}
        </div>

        <SectionBox label="Standing guardrails" meta="apply to every session">
          <div className="divide-y divide-border-subtle">
            {guide.guardrails.map((rule) => (
              <div key={rule.id} className="flex items-center gap-2.5 px-3.5 py-2">
                <PolicyPill policy={rule.policy} />
                <span className="text-body text-text-primary">{rule.text}</span>
              </div>
            ))}
          </div>
        </SectionBox>

        <SectionBox label="Served automatically" meta="nothing to install">
          <div className="grid grid-cols-1 sm:grid-cols-2">
            <AutoServedCell
              icon={<Sparkles size={13} />}
              title={`${guide.autoServed.skills.length} skills`}
              items={guide.autoServed.skills}
            />
            <AutoServedCell
              icon={<BookOpen size={13} />}
              title={`${guide.autoServed.knowledgeBases.length} knowledge bases`}
              items={guide.autoServed.knowledgeBases}
              className="border-t border-border-subtle sm:border-l sm:border-t-0"
            />
          </div>
          <p className="border-t border-border-subtle px-3.5 py-2.5 text-caption leading-relaxed text-text-muted">
            Served live from the workspace over MCP. When {guide.publishedBy}{" "}
            publishes a change, your agent picks it up on its next run.
          </p>
        </SectionBox>
      </div>
    </div>
  );
}

function AutoServedCell({
  icon,
  title,
  items,
  className,
}: {
  icon: React.ReactNode;
  title: string;
  items: string[];
  className?: string;
}) {
  return (
    <div className={cn("p-3.5", className)}>
      <div className="flex items-center gap-1.5 text-body font-semibold text-text-primary">
        {icon} {title}
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {items.map((item) => (
          <span key={item} className={CHIP}>
            {item}
          </span>
        ))}
      </div>
    </div>
  );
}
