"use client";

import { useState } from "react";
import { FileText, Plus, ShieldCheck, X } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { MenuItem, Popover } from "@/shared/ui/popover-menu";
import { SectionBox } from "@/shared/ui/section-box";
import { FIELD_WELL } from "@/shared/ui/wells";
import { MISSION_STARTERS } from "../mock-data";
import type { AgentGuide, GuardrailPolicy, GuardrailRule } from "../types";
import {
  AddRowButton,
  DetailHeader,
  DetailShell,
  IdentityBlock,
  KindTile,
  POLICY_META,
  PolicyPill,
} from "./config-fields";

/** Base instructions every agent session starts from, plus starters. */
export function MissionEditor({
  guide,
  onPatch,
}: {
  guide: AgentGuide;
  onPatch: (patch: Partial<AgentGuide>) => void;
}) {
  const tokens = Math.ceil(guide.mission.length / 4);
  return (
    <DetailShell
      header={<DetailHeader kind="Profile" meta="Prepended to every agent session" />}
    >
      <IdentityBlock
        tile={<KindTile icon={FileText} size="md" />}
        name="Agent instructions"
        summary={`The voice and standing orders every ${guide.teamName} agent starts with.`}
      />

      <SectionBox label="Instructions" meta={`~${tokens} tokens`}>
        <textarea
          value={guide.mission}
          onChange={(e) => onPatch({ mission: e.target.value })}
          rows={10}
          aria-label="Agent instructions"
          className="w-full resize-none bg-transparent p-3 text-lead leading-relaxed text-text-primary placeholder:text-text-muted focus:outline-none"
          placeholder="How should your team's agents behave, always…"
        />
      </SectionBox>

      <SectionBox label="Prompt starters" meta="click to append a template">
        <div className="flex flex-wrap gap-1.5 p-3">
          {MISSION_STARTERS.map((starter) => (
            <button
              key={starter.label}
              type="button"
              onClick={() => onPatch({ mission: guide.mission + starter.text })}
              className="btn-light flex h-6 items-center gap-1 rounded-full px-2.5 text-caption font-medium text-text-primary"
            >
              <Plus size={10} /> {starter.label}
            </button>
          ))}
        </div>
      </SectionBox>
    </DetailShell>
  );
}

/** Standing allow / ask-first / never rules. */
export function GuardrailsEditor({
  guide,
  onPatch,
}: {
  guide: AgentGuide;
  onPatch: (patch: Partial<AgentGuide>) => void;
}) {
  const [draft, setDraft] = useState("");
  const [draftPolicy, setDraftPolicy] = useState<GuardrailPolicy>("ask");
  const [policyMenuFor, setPolicyMenuFor] = useState<string | null>(null);

  const rules = guide.guardrails;
  const patchRule = (id: string, patch: Partial<GuardrailRule>) =>
    onPatch({
      guardrails: rules.map((r) => (r.id === id ? { ...r, ...patch } : r)),
    });
  const add = () => {
    const text = draft.trim();
    if (!text) return;
    onPatch({
      guardrails: [
        ...rules,
        { id: `gr-${Date.now()}`, policy: draftPolicy, text },
      ],
    });
    setDraft("");
  };

  return (
    <DetailShell
      header={<DetailHeader kind="Profile" meta={`${rules.length} standing rules`} />}
    >
      <IdentityBlock
        tile={<KindTile icon={ShieldCheck} size="md" />}
        name="Guardrails"
        summary="What agents may do freely, must ask about, and never touch."
      />

      <SectionBox label="Rules">
        <div className="divide-y divide-border-subtle">
          {rules.map((rule) => (
            <div key={rule.id} className="group flex items-center gap-2.5 px-3.5 py-2">
              <span className="relative shrink-0">
                <button
                  type="button"
                  aria-label={`Change policy for "${rule.text}"`}
                  onClick={() => setPolicyMenuFor(rule.id)}
                >
                  <PolicyPill policy={rule.policy} />
                </button>
                <Popover
                  open={policyMenuFor === rule.id}
                  onClose={() => setPolicyMenuFor(null)}
                >
                  {(Object.keys(POLICY_META) as GuardrailPolicy[]).map((policy) => (
                    <MenuItem
                      key={policy}
                      showCheck
                      active={rule.policy === policy}
                      description={POLICY_DESCRIPTIONS[policy]}
                      onSelect={() => {
                        patchRule(rule.id, { policy });
                        setPolicyMenuFor(null);
                      }}
                    >
                      {POLICY_META[policy].label}
                    </MenuItem>
                  ))}
                </Popover>
              </span>
              <input
                type="text"
                value={rule.text}
                onChange={(e) => patchRule(rule.id, { text: e.target.value })}
                aria-label="Rule text"
                className="min-w-0 flex-1 bg-transparent text-body text-text-primary focus:outline-none"
              />
              <button
                type="button"
                aria-label={`Remove rule "${rule.text}"`}
                onClick={() =>
                  onPatch({ guardrails: rules.filter((r) => r.id !== rule.id) })
                }
                className="rounded-md p-1 text-text-muted opacity-0 transition hover:bg-surface-raised-3 hover:text-text-primary group-hover:opacity-100"
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-1.5 border-t border-border-subtle bg-card-surface-subtle px-4 py-2">
          <select
            value={draftPolicy}
            onChange={(e) => setDraftPolicy(e.target.value as GuardrailPolicy)}
            aria-label="New rule policy"
            className={cn(FIELD_WELL, "h-7 px-1.5 text-small text-text-secondary")}
          >
            {(Object.keys(POLICY_META) as GuardrailPolicy[]).map((policy) => (
              <option key={policy} value={policy}>
                {POLICY_META[policy].label}
              </option>
            ))}
          </select>
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && add()}
            placeholder="new rule, in plain language…"
            aria-label="New guardrail rule"
            className={cn(FIELD_WELL, "h-7 min-w-0 flex-1 px-2.5 text-body text-text-primary placeholder:text-text-muted")}
          />
          <AddRowButton onClick={add} />
        </div>
      </SectionBox>

      <p className="px-1 text-caption leading-relaxed text-text-muted">
        Guardrails ride along with the agent context — every member&apos;s agent
        sees the same rules, phrased exactly as written here.
      </p>
    </DetailShell>
  );
}

const POLICY_DESCRIPTIONS: Record<GuardrailPolicy, string> = {
  always: "Runs without confirmation",
  ask: "Agent checks with the member first",
  never: "Blocked in every session",
};
