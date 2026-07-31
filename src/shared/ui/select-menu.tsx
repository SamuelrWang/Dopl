"use client";

/**
 * SelectMenu — the design-system dropdown for picking ONE value from a small,
 * fixed set of options where each option needs a plain-words explanation.
 *
 * It is NOT a new primitive: it composes the kit's `Popover` + `MenuItem`
 * (popover-menu.tsx) so the backdrop / Escape / viewport-clamp behavior and the
 * option-row styling stay in one place. What it adds is the SELECT shape the kit
 * was missing — a pill trigger that names the current value, and options that
 * carry a `description` line, so an operator can read what a setting actually
 * does before choosing it instead of decoding a bare enum name.
 *
 * Use this anywhere a bare native `<select>` would otherwise appear: a native
 * select cannot show per-option descriptions, and it renders OS chrome that has
 * nothing to do with the kit.
 *
 * The panel opens in the Popover's COORDINATE mode (measured off the trigger on
 * open) rather than the trigger-anchored mode, because these controls sit inside
 * scrolling, overflow-clipping panes (the channel transcript, a `.page-float`)
 * where an anchored panel would render as a clipped sliver.
 */

import { useRef, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { MenuItem, Popover } from "@/shared/ui/popover-menu";

export interface SelectMenuOption<T extends string> {
  value: T;
  /** Short name shown on the trigger and as the option's title. */
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
  /** Optional leading icon inside the pill. */
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
