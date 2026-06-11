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
              className={`px-3.5 py-2 rounded-[11px] border-[1.5px] text-[14px] font-medium transition-colors cursor-pointer ${
                selected
                  ? "border-[#6f93bf] bg-[#e3eaf2] text-[#232a31]"
                  : "border-[#d6dde5] bg-[#f6f8fb] text-[#3a414a] hover:border-[#b9c6d3] hover:bg-[#fdfefe]"
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
          className="w-full rounded-[11px] border-[1.5px] border-[#d6dde5] bg-white px-3.5 py-2.5
            text-[14px] text-[#232a31] placeholder:text-[#98a2ad]
            focus:outline-none focus:border-[#6f93bf] transition-colors"
        />
      )}
    </div>
  );
}
