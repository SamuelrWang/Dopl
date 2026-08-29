"use client";

/**
 * SelectMenu — pick ONE value from a small fixed set where each option needs a
 * plain-words explanation. Composes `Popover` + `MenuItem`. Use anywhere a
 * native `<select>` would go: native can't show per-option descriptions.
 *
 * ⚠ Opens in Popover COORDINATE mode, not trigger-anchored: these controls sit
 * inside scrolling, overflow-clipping panes (channel transcript, `.page-float`)
 * where an anchored panel renders as a clipped sliver.
 *
 * ⚠ TWO TRIGGER FACES, AND EACH OWNS ITS WHOLE FACE (`variant`). `flat` is the
 * inset pill this control has always worn — right on a settings row, beside
 * other flat chrome. `raised` is the kit's white RAISED button
 * (`.auth-btn-3d-light`), which is what every dropdown inside a
 * `StandardDialog` wears (Samuel, 2026-08-27). The two strings do not compose:
 * `flat`'s `hover:bg-surface-raised-2` would flatten the raised gradient to a
 * solid tint (DESIGN-SYSTEM's warning on `.raised-tab`), and font size/padding
 * live in the variant rather than the base so a caller's `className` never has
 * to win a same-layer fight with them.
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

/** Trigger faces, whole. See the header — these are alternatives, not layers. */
const TRIGGER_FACE = {
  flat: cn(
    "border border-border-strong bg-bg-inset px-2.5 py-1 text-caption text-text-secondary",
    "transition-colors hover:bg-surface-raised-2 hover:text-text-primary"
  ),
  raised: "auth-btn-3d-light h-9 px-3 text-body text-text-primary",
  /**
   * `raised` AT FIELD-ROW HEIGHT (Samuel, 2026-08-27) — the composer panels' Template and Model
   * rows.
   *
   * ⚠ A SIZE OF THE SAME FACE, NOT A FORK. It is `auth-btn-3d-light` exactly as `raised` is, so
   * the elevation cannot drift; only the box shrinks. ⚠ IT EXISTS BECAUSE THE FIELD CARD OWNS THE
   * ROW HEIGHT: a `h-9` trigger inside a `py-2.5` card makes that one row ~56px while every text
   * row beside it is ~40px, and a form whose rows are two heights reads as broken alignment
   * rather than as two kinds of control. `h-6` + `text-small` is what fits the card's own line box
   * with the card's padding left intact.
   */
  raisedField: "auth-btn-3d-light h-6 px-2 text-small text-text-primary",
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
  /** Trigger face. `"raised"` is THE dialog dropdown; see the header. */
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
          "inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-full font-medium",
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
