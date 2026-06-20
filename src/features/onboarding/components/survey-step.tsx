"use client";

import { useState } from "react";
import {
  DESCRIPTOR_OPTIONS,
  DESCRIPTOR_QUESTION,
  ENTITY_OPTIONS,
  SIZE_BUCKETS,
  SIZE_LABEL,
  type EntityType,
} from "../constants";
import type { SurveySubmission } from "../types";

interface SurveyStepProps {
  submitting: boolean;
  onSubmit: (answers: SurveySubmission) => void;
}

export function SurveyStep({ submitting, onSubmit }: SurveyStepProps) {
  const [entity, setEntity] = useState<EntityType | null>("team");
  const [descriptors, setDescriptors] = useState<string[]>([]);
  const [sizeIndex, setSizeIndex] = useState(1);

  const needsSize = entity === "team" || entity === "company";
  const canContinue = entity !== null && descriptors.length > 0 && !submitting;

  function chooseEntity(next: EntityType) {
    setEntity(next);
    setDescriptors([]); // descriptor options differ per identity
  }

  function toggleDescriptor(value: string) {
    setDescriptors((prev) =>
      prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value],
    );
  }

  function handleSubmit() {
    if (!canContinue || !entity) return;
    onSubmit({
      entityType: entity,
      descriptors,
      size: needsSize ? SIZE_BUCKETS[sizeIndex] : undefined,
    });
  }

  const fillPct = (sizeIndex / (SIZE_BUCKETS.length - 1)) * 100;

  return (
    <div>
      <h2 className="text-[30px] font-bold leading-tight tracking-[-0.5px] text-[#181818]">
        About You
      </h2>
      <p className="mt-3 text-[15px] leading-relaxed text-[#9a9a9a]">
        Dopl works whether you&apos;re flying solo or building with a whole team.
      </p>

      {/* Identity */}
      <div className="mt-8">
        <p className="mb-3 text-[16px] font-medium text-[#181818]">I&apos;m using Dopl as…</p>
        <div className="flex flex-wrap gap-2.5">
          {ENTITY_OPTIONS.map((opt) => (
            <Pill key={opt.value} selected={entity === opt.value} onClick={() => chooseEntity(opt.value)}>
              {opt.label}
            </Pill>
          ))}
        </div>
      </div>

      {/* Descriptors */}
      {entity && (
        <div className="mt-7" style={{ animation: "loginFadeIn 0.4s ease-out both" }}>
          <p className="mb-3 text-[16px] font-medium text-[#181818]">{DESCRIPTOR_QUESTION[entity]}</p>
          <div className="flex flex-wrap gap-2.5">
            {DESCRIPTOR_OPTIONS[entity].map((opt) => (
              <Pill
                key={opt.value}
                selected={descriptors.includes(opt.value)}
                onClick={() => toggleDescriptor(opt.value)}
              >
                {opt.label}
              </Pill>
            ))}
          </div>
        </div>
      )}

      {/* Size slider */}
      {needsSize && entity && (
        <div className="mt-8" style={{ animation: "loginFadeIn 0.4s ease-out both" }}>
          <p className="mb-2 text-[16px] font-medium text-[#181818]">{SIZE_LABEL[entity]}</p>
          <p className="text-[26px] font-bold text-[#181818]">{SIZE_BUCKETS[sizeIndex]} people</p>
          <input
            type="range"
            min={0}
            max={SIZE_BUCKETS.length - 1}
            step={1}
            value={sizeIndex}
            onChange={(e) => setSizeIndex(Number(e.target.value))}
            aria-label={SIZE_LABEL[entity]}
            className="dopl-slider mt-4"
            style={{
              background: `linear-gradient(to right, #181818 ${fillPct}%, #e2e2e2 ${fillPct}%)`,
            }}
          />
        </div>
      )}

      {/* Continue (no go-back) */}
      <div className="mt-9 flex justify-end">
        <button
          type="button"
          disabled={!canContinue}
          onClick={handleSubmit}
          className="cursor-pointer rounded-[12px] bg-[#181818] px-9 py-3 text-[15px] font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {submitting ? "Saving…" : "Continue"}
        </button>
      </div>
    </div>
  );
}

function Pill({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`cursor-pointer rounded-full px-4 py-2 text-[14px] font-medium transition-colors ${
        selected
          ? "bg-[#181818] text-white"
          : "bg-[#d7d7d7] text-[#181818] hover:bg-[#cccccc]"
      }`}
    >
      {children}
    </button>
  );
}
