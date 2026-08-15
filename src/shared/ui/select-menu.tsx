"use client";

/**
 * SelectMenu — pick ONE value from a small fixed set where each option needs a
 * plain-words explanation. Composes `Popover` + `MenuItem`. Use anywhere a
 * native `<select>` would go: native can't show per-option descriptions.
 *
 * ⚠ Opens in Popover COORDINATE mode, not trigger-anchored: these controls sit
 * inside scrolling, overflow-clipping panes (channel transcript, `.page-float`)
 * where an anchored panel renders as a clipped sliver.
 */

import { useRef, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { MenuItem, Popover } from "@/shared/ui/popover-menu";

export interface SelectMenuOption<T extends string> {
  value: T;
  label: string;
  /** Plain-words second line: what choosing this actually does. */
  description?: string;
}

export function SelectMenu<T extends string>({
  value,
  options,
  onChange,
  prefix,
  icon,
  ariaLabel,
  disabled,
  className,
  menuClassName,
}: {
  value: T;
  options: ReadonlyArray<SelectMenuOption<T>>;
  onChange: (next: T) => void;
  /** Muted leading word inside the pill ("Tools", "Messages"). */
  prefix?: string;
  icon?: ReactNode;
  /** Accessible name for the trigger. */
  ariaLabel: string;
  disabled?: boolean;
  className?: string;
  menuClassName?: string;
}) {
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  const selected = options.find((o) => o.value === value) ?? options[0];

  function toggle() {
    if (anchor) {
      setAnchor(null);
      return;
    }
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) setAnchor({ x: rect.left, y: rect.bottom + 4 });
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={toggle}
        disabled={disabled}
        aria-label={ariaLabel}
        title={selected?.description ?? ariaLabel}
        aria-haspopup="menu"
        aria-expanded={anchor !== null}
        className={cn(
          "inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-full border border-border-strong bg-bg-inset px-2.5 py-1",
          "text-caption font-medium text-text-secondary transition-colors",
          "hover:bg-surface-raised-2 hover:text-text-primary disabled:opacity-60",
          className
        )}
      >
        {icon}
        {prefix && <span className="shrink-0 text-text-muted">{prefix}</span>}
        <span className="min-w-0 truncate text-text-primary">
          {selected?.label ?? value}
        </span>
        <ChevronDown size={11} className="shrink-0" />
      </button>
      <Popover
        open={anchor !== null}
        at={anchor ?? undefined}
        onClose={() => setAnchor(null)}
        className={cn("min-w-[280px] max-w-[340px]", menuClassName)}
      >
        {options.map((option) => (
          <MenuItem
            key={option.value}
            showCheck
            active={option.value === value}
            description={option.description}
            onSelect={() => {
              setAnchor(null);
              if (option.value !== value) onChange(option.value);
            }}
          >
            {option.label}
          </MenuItem>
        ))}
      </Popover>
    </>
  );
}
