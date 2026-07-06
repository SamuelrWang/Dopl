"use client";

import { BookOpen, Check, MessageCircleQuestion, Sparkles } from "lucide-react";
import { AGENT_SETUP_PROMPT } from "../mock-data";
import type { AgentProfile } from "../types";
import { ConnectionCard } from "./connection-card";
import { CopyButton, SectionPanel } from "./config-bits";

/**
 * Employee (read) side of the configuration page: a setup wizard the team
 * profile drives. Static preview — copy buttons work, the rest is sample
 * state.
 */
export function EmployeeView({ profile }: { profile: AgentProfile }) {
  const enabledSkills = profile.skills.filter((s) => s.enabled);
  const enabledKbs = profile.knowledgeBases.filter((kb) => kb.enabled);
  const pending = profile.connections.filter((c) => c.status === "action-needed");
  const done = profile.connections.length - pending.length;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5">
      <div className="rounded-[14px] border border-black/[0.12] bg-white p-5">
        <h2 className="text-lg font-semibold leading-snug tracking-tight text-text-primary">
          Set up your agent for {profile.teamName}
        </h2>
        <p className="mt-1 text-sm leading-relaxed text-text-secondary">
          {profile.publishedBy} keeps this profile up to date (currently v
          {profile.version}). Finish the steps below once — after that your
          agent stays in sync automatically.
        </p>
        <div className="mt-3.5 flex items-center gap-3">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-bg-inset shadow-[inset_0_1px_2px_rgba(0,0,0,0.1)]">
            <div
              className="h-full rounded-full bg-[#1c2127]"
              style={{ width: `${(done / profile.connections.length) * 100}%` }}
            />
          </div>
          <span className="text-xs font-semibold text-text-secondary">
            {done} of {profile.connections.length} connected
          </span>
        </div>
      </div>

      <SectionPanel label="Fastest path — let your agent set itself up" inset flush>
        <div className="border-t border-black/[0.06] bg-bg-inset p-3.5">
          <p className="text-sm leading-relaxed text-text-primary">
            Already have an agent (Claude Code, Cursor, anything MCP-capable)?
            Paste this prompt and it will connect to Dopl, read this profile,
            and walk you through the rest.
          </p>
          <div className="mt-2.5 flex items-start gap-2 rounded-lg border border-black/[0.08] bg-white px-3 py-2.5">
            <p className="min-w-0 flex-1 font-mono text-[11.5px] leading-relaxed text-text-secondary">
              {AGENT_SETUP_PROMPT}
            </p>
            <CopyButton text={AGENT_SETUP_PROMPT} label="Copy setup prompt" />
          </div>
        </div>
      </SectionPanel>

      <SectionPanel
        label="Or connect each tool yourself"
        meta={`${pending.length} remaining`}
        flush
      >
        <div className="flex flex-col gap-3 border-t border-black/[0.06] p-3.5">
          {profile.connections.map((c) => (
            <ConnectionCard
              key={c.id}
              connection={c}
              mode="employee"
              defaultOpen={c.status === "action-needed"}
            />
          ))}
        </div>
      </SectionPanel>

      <SectionPanel label="Included automatically — nothing to install">
        <div className="grid grid-cols-1 divide-y divide-black/[0.05] sm:grid-cols-2 sm:divide-x sm:divide-y-0">
          <div className="p-4">
            <div className="flex items-center gap-1.5 text-[13px] font-semibold text-text-primary">
              <Sparkles size={13} /> {enabledSkills.length} skills
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {enabledSkills.map((s) => (
                <span
                  key={s.id}
                  className="rounded-full bg-bg-inset px-2 py-0.5 text-[11px] font-medium text-text-secondary"
                >
                  {s.name}
                </span>
              ))}
            </div>
          </div>
          <div className="p-4">
            <div className="flex items-center gap-1.5 text-[13px] font-semibold text-text-primary">
              <BookOpen size={13} /> {enabledKbs.length} knowledge bases
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {enabledKbs.map((kb) => (
                <span
                  key={kb.id}
                  className="rounded-full bg-bg-inset px-2 py-0.5 text-[11px] font-medium text-text-secondary"
                >
                  {kb.name}
                </span>
              ))}
            </div>
          </div>
        </div>
        <p className="border-t border-black/[0.05] px-4 py-2.5 text-xs leading-relaxed text-text-muted">
          Served live from your workspace over MCP. When {profile.publishedBy}
          {" "}publishes a change, your agent picks it up on its next run.
        </p>
      </SectionPanel>

      <SectionPanel label="Verify your setup">
        <div className="flex flex-col gap-2.5 p-4">
          <VerifyRow done text='Dopl connected — your agent can see this profile' />
          <VerifyRow done text="Slack and GitHub authorized" />
          <VerifyRow
            done={false}
            text="Notion pending — connect it above, or ask your agent:"
          />
          <div className="ml-6 flex items-center gap-2 rounded-lg border border-black/[0.08] bg-white px-3 py-2">
            <code className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-text-primary">
              Check my Growth Team setup and fix anything missing.
            </code>
            <CopyButton
              text="Check my Growth Team setup and fix anything missing."
              label="Copy verify prompt"
            />
          </div>
        </div>
      </SectionPanel>
    </div>
  );
}

function VerifyRow({ done, text }: { done: boolean; text: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <span
        className={
          done
            ? "flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-full bg-[#25784a] text-white"
            : "flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-full bg-[#fdf1df] text-[#a16a12]"
        }
      >
        {done ? <Check size={11} /> : <MessageCircleQuestion size={11} />}
      </span>
      <span className="text-[13px] text-text-primary">{text}</span>
    </div>
  );
}
