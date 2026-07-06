"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import type { AgentProfile } from "../types";
import { ConnectionCard } from "./connection-card";
import { KnowledgeSection } from "./knowledge-section";
import { SectionPanel } from "./config-bits";
import { SkillsSection } from "./skills-section";
import { GuardrailsPanel, PublishPanel, TeamStatusPanel } from "./side-panels";

/**
 * Manager (edit) side of the configuration page. Static preview —
 * interactions flip local state only; nothing persists.
 */
export function ManagerView({ profile }: { profile: AgentProfile }) {
  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_330px]">
      <div className="flex min-w-0 flex-col gap-5">
        <InstructionsPanel instructions={profile.instructions} />

        <SectionPanel
          label="Connections"
          meta={`${profile.connections.length} tools`}
          action={
            <button
              type="button"
              className="btn-light flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium text-text-primary"
            >
              <Plus size={12} /> Add connection
            </button>
          }
          flush
        >
          <div className="flex flex-col gap-3 border-t border-black/[0.06] p-3.5">
            {profile.connections.map((c, i) => (
              <ConnectionCard
                key={c.id}
                connection={c}
                mode="manager"
                defaultOpen={i === 0}
              />
            ))}
          </div>
        </SectionPanel>

        <SkillsSection skills={profile.skills} />
        <KnowledgeSection knowledgeBases={profile.knowledgeBases} />
      </div>

      <div className="flex flex-col gap-5">
        <PublishPanel profile={profile} />
        <TeamStatusPanel profile={profile} />
        <GuardrailsPanel profile={profile} />
      </div>
    </div>
  );
}

function InstructionsPanel({ instructions }: { instructions: string }) {
  const [value, setValue] = useState(instructions);
  return (
    <SectionPanel
      label="Agent instructions"
      meta="Prepended to every agent session"
      inset
      flush
    >
      <div className="border-t border-black/[0.06] bg-bg-inset">
        <textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          rows={5}
          className="w-full resize-none bg-transparent p-3 text-sm leading-relaxed text-text-primary focus:outline-none"
          aria-label="Agent instructions"
        />
        <div className="flex items-center gap-3 border-t border-black/[0.05] px-3 py-1.5">
          <span className="text-[11px] text-text-muted">
            ~{Math.ceil(value.length / 4)} tokens
          </span>
          <span className="flex-1" />
          <button
            type="button"
            className="btn-light rounded-md px-2 py-0.5 text-[11px] font-medium text-text-primary"
          >
            Preview what the agent sees
          </button>
        </div>
      </div>
    </SectionPanel>
  );
}
