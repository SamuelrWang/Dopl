"use client";

import { Search, X } from "lucide-react";
import { cn } from "@/shared/lib/utils";

const SIZE = {
  sm: {
    icon: 13,
    well: "rounded-[8px]",
    iconPos: "left-2.5",
    input: "h-8 pl-[30px] pr-2.5 text-small",
  },
  md: {
    icon: 15,
    well: "rounded-[9px]",
    iconPos: "left-3",
    input: "h-9 pl-[33px] pr-3 text-body",
  },
} as const;

interface SearchFieldProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** `md` (h-9) for list-pane headers, `sm` (h-8) for compact toolbars. */
  size?: keyof typeof SIZE;
  autoFocus?: boolean;
  onFocus?: () => void;
  /** Renders a clear (×) affordance while there's a value. */
  onClear?: () => void;
  /** Layout-only additions (margins, width) — recipes stay in the kit. */
  className?: string;
}

/**
 * Concave search well — the `.concave-field` + leading Search icon
 * recipe every pane's filter input composes (chats / skills /
 * knowledge / members) instead of hand-rolling the icon + inset input.
 */
export function SearchField({
  value,
  onChange,
  placeholder = "Search",
  size = "md",
  autoFocus,
  onFocus,
  onClear,
  className,
}: SearchFieldProps) {
  const s = SIZE[size];
  return (
    <div className={cn("concave-field relative", s.well, className)}>
      <Search
        size={s.icon}
        className={cn(
          "pointer-events-none absolute top-1/2 -translate-y-1/2 text-text-muted",
          s.iconPos
        )}
      />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={onFocus}
        placeholder={placeholder}
        autoFocus={autoFocus}
        spellCheck={false}
        className={cn(
          "w-full bg-transparent text-text-primary outline-none placeholder:text-text-muted",
          s.input,
          onClear && value && "pr-8"
        )}
      />
      {onClear && value ? (
        <button
          type="button"
          aria-label="Clear search"
          onClick={onClear}
          className="absolute right-1.5 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded text-text-muted transition-colors hover:text-text-primary"
        >
          <X size={12} />
        </button>
      ) : null}
    </div>
  );
}
