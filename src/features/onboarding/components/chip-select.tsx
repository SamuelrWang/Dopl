"use client";

import { OTHER_OPTION_VALUE, type SurveyOption } from "../constants";

interface ChipSelectProps {
  options: SurveyOption[];
  mode: "single" | "multi";
  /** Selected option values (length ≤ 1 in single mode). */
  value: string[];
  onChange: (next: string[]) => void;
  /** Appends an "Other" chip that reveals a free-text input. */
  allowOther?: boolean;
  otherText?: string;
  onOtherTextChange?: (text: string) => void;
}

/**
 * Chip-style selector for the onboarding survey, in the knowledge-landing
 * colorway: light card chips, lavender + blue when selected. Single mode
 * behaves like a radio group; multi mode toggles. The "Other" chip is a
 * normal selection whose free text rides alongside in `otherText`.
 */
export function ChipSelect({
  options,
  mode,
  value,
  onChange,
  allowOther = false,
  otherText = "",
  onOtherTextChange,
}: ChipSelectProps) {
  const allOptions = allowOther
    ? [...options, { value: OTHER_OPTION_VALUE, label: "Other" }]
    : options;
  const otherSelected = value.includes(OTHER_OPTION_VALUE);

  function toggle(optionValue: string) {
    const selected = value.includes(optionValue);
    if (mode === "single") {
      onChange(selected ? [] : [optionValue]);
      return;
    }
    onChange(
      selected
        ? value.filter((v) => v !== optionValue)
        : [...value, optionValue]
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2" role="group">
        {allOptions.map((option) => {
          const selected = value.includes(option.value);
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={selected}
              onClick={() => toggle(option.value)}
              className={`px-3.5 py-2 rounded-[8px] border-[1.5px] text-[14px] font-medium transition-colors cursor-pointer ${
                selected
                  ? "border-[#7E9CC4] bg-[#1C3252] text-[#EAF2FB] shadow-[0_0_0_1px_rgba(76,141,245,0.4)]"
                  : "border-[#33414F] bg-[#1E2836] text-[#BCC6D2] hover:border-[#44566A] hover:bg-[#273341]"
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </div>
      {otherSelected && (
        <input
          autoFocus
          type="text"
          value={otherText}
          maxLength={200}
          placeholder="Tell us more…"
          onChange={(e) => onOtherTextChange?.(e.target.value)}
          className="w-full rounded-[8px] border-[1.5px] border-[#33414F] bg-[#1A222E] px-3.5 py-2.5
            text-[14px] text-[#ECF1F6] placeholder:text-[#6B7682]
            focus:outline-none focus:border-[#7E9CC4] transition-colors"
        />
      )}
    </div>
  );
}
