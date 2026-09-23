"use client";

/**
 * SelectMenu — pick one value from a small fixed set where each option needs a plain-words
 * explanation (a native `<select>` cannot show per-option descriptions). Composes `Popover` +
 * `MenuItem`, in coordinate mode, not trigger-anchored: these controls sit in scrolling,
 * overflow-clipping panes where an anchored panel renders as a clipped sliver.
 * Each `variant` owns its whole trigger face (weight, size, padding included), so faces never
 * compose and a caller's `className` never fights them in the same layer.
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

/** Trigger faces, whole: alternatives, not layers. */
const TRIGGER_FACE = {
  flat: cn(
    "border border-border-strong bg-bg-inset px-2.5 py-1 text-caption font-medium text-text-secondary",
    "transition-colors hover:bg-surface-raised-2 hover:text-text-primary"
  ),
  raised: "auth-btn-3d-light h-9 px-3 text-body font-medium text-text-primary",
  /** `raised` at field-row height (composer panels' Identity and Model rows): the same face, only
   *  the box shrinks, so the row matches its ~40px text-row siblings. */
  raisedField: "auth-btn-3d-light h-6 px-2 text-small font-medium text-text-primary",
  /**
   * No pill at all: the settings-row face (label + chevron). The chevron is then the only hint of
   * a menu, and the gray `--menu-item-hover-bg` hover the only face, so neither may be dropped.
   * `-mx-1.5 px-1.5` widens the hover box without moving the value off the row's right rail; the
   * hover is suppressed while disabled. Settings rows only: on a card a bare label reads as
   * unstyled text.
   */
  text: cn(
    "-mx-1.5 rounded-md px-1.5 py-0 text-body font-normal text-text-primary",
    "transition-colors hover:bg-menu-item-hover-bg disabled:hover:bg-transparent"
  ),
} as const;

export function SelectMenu<T extends string>({
  value,
  options,
  onChange,
  prefix,
  icon,
  ariaLabel,
  disabled,
  variant = "flat",
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
  /** Trigger face. `"raised"` is the dialog dropdown. */
  variant?: keyof typeof TRIGGER_FACE;
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
          // No weight here: each variant owns its own.
          "inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-full",
          "disabled:opacity-60",
          TRIGGER_FACE[variant],
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
