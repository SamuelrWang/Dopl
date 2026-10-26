"use client";

import { useRef } from "react";
import { Search, X } from "lucide-react";
import { cn } from "@/shared/lib/utils";

/** THE search pill's face: /home's header search, and every field that should look like it. */
export const SEARCH_PILL_FACE =
  "white-card raise-pill flex h-9 w-[260px] cursor-text items-center gap-2 rounded-full px-3.5 text-text-muted";

/** The input inside {@link SEARCH_PILL_FACE}. */
export const SEARCH_PILL_INPUT =
  "min-w-0 flex-1 bg-transparent text-small text-text-primary outline-none placeholder:text-text-muted";

/**
 * A FILTER field on the search pill's face, with a clear once it has a value (a filter you cannot
 * drop traps what it filters). Escape clears too. Not `SearchField`, which is concave and banned
 * on /home.
 */
export function SearchPill({
  value,
  onChange,
  label,
  className,
}: {
  value: string;
  onChange: (next: string) => void;
  /** Placeholder and accessible name. */
  label: string;
  /** Layout only. */
  className?: string;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  return (
    <label className={cn(SEARCH_PILL_FACE, className)}>
      <Search size={14} strokeWidth={2} aria-hidden="true" />
      <input
        ref={inputRef}
        className={SEARCH_PILL_INPUT}
        type="text"
        autoComplete="off"
        spellCheck={false}
        placeholder={label}
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          event.preventDefault();
          onChange("");
          inputRef.current?.blur();
        }}
      />
      {value !== "" && (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => {
            onChange("");
            inputRef.current?.focus();
          }}
          className="flex size-5 flex-none items-center justify-center rounded-full transition-colors hover:text-text-primary"
        >
          <X size={12} strokeWidth={2.5} />
        </button>
      )}
    </label>
  );
}
