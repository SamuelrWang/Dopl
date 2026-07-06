"use client";

import { ChevronsUpDown, RefreshCw } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import type { AgentProfile, GuardrailKind } from "../types";
import { MemberPill, RowList, SectionPanel } from "./config-bits";

/** Manager-side rail: publish state, team adoption, guardrails. */

export function PublishPanel({ profile }: { profile: AgentProfile }) {
  return (
    <SectionPanel label="Publish">
      <div className="p-4">
        <div className="flex items-center justify-between text-[13px]">
          <span className="text-text-secondary">Published version</span>
          <span className="font-semibold text-text-primary">v{profile.version}</span>
        </div>
        <div className="mt-1.5 flex items-center justify-between text-[13px]">
          <span className="text-text-secondary">Last updated</span>
          <span className="font-semibold text-text-primary">{profile.updatedAt}</span>
        </div>
        <div className="mt-1.5 flex items-center justify-between text-[13px]">
          <span className="text-text-secondary">Published by</span>
          <span className="font-semibold text-text-primary">{profile.publishedBy}</span>
        </div>
        <button
          type="button"
          className="auth-btn-3d mt-4 w-full rounded-lg px-3 py-2 text-[13px] font-semibold text-white"
        >
          Publish changes
        </button>
        <p className="mt-2.5 text-xs leading-relaxed text-text-muted">
          Publishing pushes this profile to every connected agent on the team.
          Members on older versions show as out of date below.
        </p>
      </div>
    </SectionPanel>
  );
}

export function TeamStatusPanel({ profile }: { profile: AgentProfile }) {
  const complete = profile.members.filter((m) => m.status === "complete").length;
  return (
    <SectionPanel
      label="Team status"
      meta={`${complete} of ${profile.members.length} set up`}
      action={
        <button
          type="button"
          className="flex items-center gap-1 text-[11px] font-medium text-text-secondary"
        >
          {profile.teamName} <ChevronsUpDown size={12} />
        </button>
      }
    >
      <RowList>
        {profile.members.map((m) => (
          <div key={m.id} className="flex items-center gap-3 px-4 py-2.5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#2c3640] text-xs font-semibold text-white">
              {m.initial}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-1.5">
                <span className="truncate text-[13px] font-semibold text-text-primary">
                  {m.name}
                </span>
                <span className="text-[11px] text-text-muted">{m.role}</span>
              </div>
              <div className="mt-px flex items-center gap-1.5 text-[11px] text-text-muted">
                <span>{m.agentActivity}</span>
                <span aria-hidden>·</span>
                <span className="flex items-center gap-1">
                  <RefreshCw size={9} /> {m.lastSync}
                </span>
              </div>
            </div>
            <div className="flex flex-col items-end gap-1">
              <MemberPill status={m.status} />
              {m.status !== "complete" && (
                <button
                  type="button"
                  className="btn-light rounded-md px-2 py-0.5 text-[10.5px] font-medium text-text-primary"
                >
                  Nudge
                </button>
              )}
            </div>
          </div>
        ))}
      </RowList>
    </SectionPanel>
  );
}

const GUARDRAIL_STYLES: Record<GuardrailKind, { label: string; cls: string }> = {
  allow: { label: "Allow", cls: "bg-[#e5f4ec] text-[#25784a]" },
  ask: { label: "Ask first", cls: "bg-[#fdf1df] text-[#a16a12]" },
  block: { label: "Never", cls: "bg-[#fdecec] text-[#c04543]" },
};

export function GuardrailsPanel({ profile }: { profile: AgentProfile }) {
  return (
    <SectionPanel label="Guardrails" meta={`${profile.guardrails.length} rules`}>
      <RowList>
        {profile.guardrails.map((g) => {
          const style = GUARDRAIL_STYLES[g.kind];
          return (
            <div key={g.id} className="flex items-center gap-3 px-4 py-2">
              <span
                className={cn(
                  "w-16 shrink-0 rounded-full px-2 py-0.5 text-center text-[10px] font-semibold uppercase tracking-wide",
                  style.cls
                )}
              >
                {style.label}
              </span>
              <span className="text-[12.5px] leading-relaxed text-text-primary">
                {g.text}
              </span>
            </div>
          );
        })}
      </RowList>
      <div className="border-t border-black/[0.05] px-4 py-2.5">
        <input
          type="text"
          placeholder="Add a rule in plain language…"
          className="w-full rounded-lg border border-black/[0.06] bg-bg-inset px-2.5 py-1.5 text-xs text-text-primary shadow-[inset_0_1px_2px_rgba(0,0,0,0.08)] placeholder:text-text-muted focus:outline-none"
        />
      </div>
    </SectionPanel>
  );
}
