"use client";

import { useRef } from "react";
import { Search, X } from "lucide-react";
import { cn } from "@/shared/lib/utils";

/**
 * A FILTER field on the kit's `.search-expand` pill, held open (a filter has no collapsed state),
 * with a clear once it has a value, because a filter you cannot drop traps what it filters.
 * Escape clears too. Not `SearchField`, which is concave and banned on /home.
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
    <div className={cn("search-expand", className)} data-open="true">
      <div className="auth-btn-3d-light search-expand-shell">
        <span className="search-expand-toggle" aria-hidden="true">
          <Search size={15} strokeWidth={2} />
        </span>
        <input
          ref={inputRef}
          className="search-expand-input"
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
            className="mr-3 flex size-5 flex-none items-center justify-center rounded-full text-text-muted transition-colors hover:text-text-primary"
          >
            <X size={12} strokeWidth={2.5} />
          </button>
        )}
      </div>
    </div>
  );
}
