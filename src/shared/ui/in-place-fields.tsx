"use client";

import { cn } from "@/shared/lib/utils";
import { InlineUnderlineField } from "./form-dialog";
import fieldStyles from "./form-dialog.module.css";

/**
 * A record's head edited in place — a knowledge entry or base, an ontology object or board: the
 * title at the page-title step with no box and no line, and the description on the kit's quiet
 * underline (no rule at rest, the ink sweep while focused) in secondary ink.
 */
export function InPlaceTitle({
  label,
  value,
  onChange,
  onBlur,
  placeholder,
  readOnly = false,
}: {
  /** The accessible name. */
  label: string;
  value: string;
  onChange: (next: string) => void;
  onBlur?: () => void;
  placeholder: string;
  readOnly?: boolean;
}) {
  return (
    <input
      type="text"
      value={value}
      readOnly={readOnly}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onBlur}
      placeholder={placeholder}
      aria-label={label}
      className="w-full min-w-0 bg-transparent text-display font-semibold leading-snug tracking-tight text-text-primary placeholder:text-text-muted focus:outline-none"
    />
  );
}

export function InPlaceDescription({
  label = "Description",
  value,
  onChange,
  onBlur,
  placeholder,
  readOnly = false,
  max,
  multiline = false,
  className,
}: {
  /** The accessible name, and the hint when there is no `placeholder`. */
  label?: string;
  value: string;
  onChange: (next: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  readOnly?: boolean;
  /** The server's ceiling: clips the text and, while editable, shows the count beside it. */
  max?: number;
  /** A textarea that grows with its text. */
  multiline?: boolean;
  /** Width/flex only. */
  className?: string;
}) {
  return (
    <div className={cn("flex min-w-0 items-end gap-3", className)}>
      <InlineUnderlineField
        label={label}
        placeholder={placeholder}
        value={value}
        onChange={(next) => onChange(max === undefined ? next : next.slice(0, max))}
        onBlur={onBlur}
        readOnly={readOnly}
        maxLength={max}
        multiline={multiline}
        quiet
        className="flex-1"
        inputClassName={fieldStyles.inputSecondary}
      />
      {max !== undefined && !readOnly ? (
        <span className="shrink-0 pb-1 font-mono text-micro text-text-muted">
          {value.length}/{max}
        </span>
      ) : null}
    </div>
  );
}
