"use client";

import { Input } from "@/shared/ui/input";
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
 * Chip-style selector for the onboarding survey. Single mode behaves
 * like a radio group; multi mode toggles. The "Other" chip is a normal
 * selection whose free text rides alongside in `otherText`.
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
              className={`px-3.5 py-2 rounded-lg border text-[13px] transition-colors cursor-pointer ${
                selected
                  ? "border-[var(--accent-primary)] bg-[var(--accent-primary)]/10 text-[var(--text-primary)] shadow-[0_0_12px_-4px_var(--accent-primary)]"
                  : "border-[var(--border-default)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]"
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </div>
      {otherSelected && (
        <Input
          autoFocus
          value={otherText}
          maxLength={200}
          placeholder="Tell us more…"
          onChange={(e) => onOtherTextChange?.(e.target.value)}
        />
      )}
    </div>
  );
}
