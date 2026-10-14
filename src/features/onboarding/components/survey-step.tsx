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
      <h2 className="text-[26px] font-bold leading-tight tracking-[-0.5px] text-[#181818]">
        About You
      </h2>

      {/* Identity */}
      <div className="mt-8">
        <p className="mb-3 text-[15px] font-medium text-[#181818]">I&apos;m using Dopl as…</p>
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
          <p className="mb-3 text-[15px] font-medium text-[#181818]">{DESCRIPTOR_QUESTION[entity]}</p>
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
          <p className="mb-2 text-[15px] font-medium text-[#181818]">{SIZE_LABEL[entity]}</p>
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
      <div className="mt-8 flex justify-end">
        <button
          type="button"
          disabled={!canContinue}
          onClick={handleSubmit}
          className="auth-btn-3d cursor-pointer rounded-[10px] px-8 py-2.5 text-[14px] font-semibold text-white"
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
      // SELECTED wears `.auth-btn-3d`, THE SAME CLASS the Continue button
      // wears (Samuel #3076) — the class itself, not its values, so the
      // gradient fill, the two bevel insets, the raised shadow and the
      // hover-lift / press-in states can never drift from the CTA's. It
      // replaces a flat `bg-[#181818]`, and it sets no radius, so the pill
      // stays a pill.
      // ⚠ `transition-colors` is NOT on the base: `.auth-btn-3d` declares its
      // own transition for transform/box-shadow/filter, and a second
      // `transition` from Tailwind would race it in the cascade and drop the
      // hover lift. Unselected keeps the colour transition it needs.
      //
      // UNSELECTED wears the SAME skin an unchosen option wears on an in-chat
      // decision card — `DECISION_BTN_GREY` in
      // `features/channels/components/escalation-card-face.ts`, i.e. the
      // `--seg-fill` switcher gray. Read through the same variable rather than
      // copied, so the two cannot drift; the old `#d7d7d7` was a darker gray
      // this surface had minted for itself.
      // ⚠ UNSELECTED CARRIES A TRANSPARENT 1px BORDER AND MUST KEEP IT.
      // `.auth-btn-3d` brings `border: 1px solid #000`, so without this the
      // selected pill is 2px wider and 2px taller than every other pill and
      // selecting one shoves its neighbours along the row (Samuel #3093).
      // Matching the border here, rather than stripping it off the shared CTA
      // class, keeps the two states on ONE layout box without touching the
      // button recipe. Put it on this arm only, never the base: a Tailwind
      // `border-transparent` on the base would race `.auth-btn-3d`'s own
      // border-color in the cascade.
      // Everything else that could move the box is already shared above:
      // padding, font-size, font-weight, line-height, radius. The raised look
      // is fill + shadow, and the hover lift is `transform`, so neither
      // reflows.
      // ⚠ NO `transition-colors` ON EITHER ARM, and that is the fix for the
      // black edge that lingered after unselecting (Samuel #3095).
      // `.auth-btn-3d`'s fill is a `linear-gradient`, i.e. a background-IMAGE,
      // which no colour transition can animate — measured: it disappears in
      // ONE frame. `border-color` and `background-color` CAN animate, so with
      // `transition-colors` the black rim and the grey fill were still ~70%
      // and ~30% of the way across at 40ms, leaving a black ring around an
      // almost-empty pill for ~200ms. Fill and rim have to change together,
      // and the only thing all three can agree on is snapping.
      // `.auth-btn-3d` keeps its own transform/box-shadow/filter transition,
      // so the hover lift and press are unaffected in both directions.
      className={`cursor-pointer rounded-full px-4 py-2 text-[14px] font-medium ${
        selected
          ? "auth-btn-3d text-white"
          : "border border-transparent bg-[var(--seg-fill)] text-text-secondary"
      }`}
    >
      {children}
    </button>
  );
}
