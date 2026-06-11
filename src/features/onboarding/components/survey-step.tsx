"use client";

import { useState } from "react";
import {
  OTHER_OPTION_VALUE,
  REFERRAL_OPTIONS,
  ROLE_OPTIONS,
  TEAM_OPTIONS,
  USE_CASE_OPTIONS,
} from "../constants";
import type { SurveySubmission } from "../types";
import { ChipSelect } from "./chip-select";

interface SurveyStepProps {
  submitting: boolean;
  onSubmit: (answers: SurveySubmission) => void;
}

export function SurveyStep({ submitting, onSubmit }: SurveyStepProps) {
  const [role, setRole] = useState<string[]>([]);
  const [roleOther, setRoleOther] = useState("");
  const [useCases, setUseCases] = useState<string[]>([]);
  const [useCasesOther, setUseCasesOther] = useState("");
  const [teamSize, setTeamSize] = useState<string[]>([]);
  const [referral, setReferral] = useState<string[]>([]);
  const [referralOther, setReferralOther] = useState("");

  const otherNeedsText = (selected: string[], text: string) =>
    selected.includes(OTHER_OPTION_VALUE) && text.trim().length === 0;

  const incomplete =
    role.length === 0 ||
    useCases.length === 0 ||
    teamSize.length === 0 ||
    referral.length === 0 ||
    otherNeedsText(role, roleOther) ||
    otherNeedsText(useCases, useCasesOther) ||
    otherNeedsText(referral, referralOther);

  function handleSubmit() {
    if (incomplete || submitting) return;
    onSubmit({
      role: role[0],
      roleOther: roleOther.trim() || undefined,
      useCases,
      useCasesOther: useCasesOther.trim() || undefined,
      teamSize: teamSize[0] as SurveySubmission["teamSize"],
      referralSource: referral[0],
      referralOther: referralOther.trim() || undefined,
    });
  }

  return (
    <div className="space-y-8">
      <div>
        <h1
          className="text-[28px] font-medium leading-tight text-[#1e242b]"
          style={{ fontFamily: "var(--font-playfair), Georgia, serif" }}
        >
          Tell us about yourself
        </h1>
        <p className="mt-2 text-[15px] text-[#646d78]">
          A few quick questions to tune Dopl to how you work.
        </p>
      </div>

      <Question index="01" label="What kind of work do you do?">
        <ChipSelect
          options={ROLE_OPTIONS}
          mode="single"
          value={role}
          onChange={setRole}
          allowOther
          otherText={roleOther}
          onOtherTextChange={setRoleOther}
        />
      </Question>

      <Question index="02" label="What will you use Dopl for?" hint="Pick all that apply">
        <ChipSelect
          options={USE_CASE_OPTIONS}
          mode="multi"
          value={useCases}
          onChange={setUseCases}
          allowOther
          otherText={useCasesOther}
          onOtherTextChange={setUseCasesOther}
        />
      </Question>

      <Question index="03" label="Who are you using it with?">
        <ChipSelect
          options={TEAM_OPTIONS}
          mode="single"
          value={teamSize}
          onChange={setTeamSize}
        />
      </Question>

      <Question index="04" label="How did you hear about us?">
        <ChipSelect
          options={REFERRAL_OPTIONS}
          mode="single"
          value={referral}
          onChange={setReferral}
          allowOther
          otherText={referralOther}
          onOtherTextChange={setReferralOther}
        />
      </Question>

      <button
        type="button"
        disabled={incomplete || submitting}
        onClick={handleSubmit}
        className="w-full px-4 py-3 rounded-[11px] text-[15px] font-semibold
          bg-[#1c2127] text-white hover:bg-[#2c3640]
          transition-colors cursor-pointer
          disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {submitting ? "Saving…" : "Continue"}
      </button>
    </div>
  );
}

function Question({
  index,
  label,
  hint,
  children,
}: {
  index: string;
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-baseline gap-2.5">
        <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-[#98a2ad]">
          {index}
        </span>
        <p className="text-[15px] font-semibold text-[#232a31]">{label}</p>
        {hint && <span className="text-[12px] text-[#98a2ad]">{hint}</span>}
      </div>
      {children}
    </div>
  );
}
