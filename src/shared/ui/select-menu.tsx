"use client";

/**
 * SelectMenu — pick one value from a small fixed set where each option needs a plain-words
 * explanation (a native `<select>` cannot show per-option descriptions). Composes `Popover` +
 * `MenuItem`, in coordinate mode, not trigger-anchored: these controls sit in scrolling,
 * overflow-clipping panes where an anchored panel renders as a clipped sliver.
 * The menu fits its options (no fixed width): floored at the trigger's width, capped by the kit.
 * Each `variant` owns its whole trigger face (weight, size, padding included), so faces never
 * compose and a caller's `className` never fights them in the same layer.
 */

import { useRef, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { WHITE_PILL } from "@/shared/ui/page-action-button";
import { MenuItem, Popover } from "@/shared/ui/popover-menu";

export interface SelectMenuOption<T extends string> {
  value: T;
  label: string;
  /** Plain-words second line: what choosing this actually does. */
  description?: string;
}

/**
 * No chrome at all: the value in ink and a muted chevron, the identity look's settings-card
 * dropdown (DESIGN-LANGUAGE §4). The chevron is the only hint of a menu and the hover is ink only,
 * since any fill here is the pill coming back. Exported for a clickable VALUE that is not a menu
 * (the working folder), so the two read as one vocabulary.
 */
export const BARE_TRIGGER_FACE = cn(
  "px-0 py-0 text-caption font-medium text-text-primary",
  "transition-colors hover:text-text-secondary disabled:hover:text-text-primary",
  "outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-text-primary"
);

/** Trigger faces, whole: alternatives, not layers. `bare` and `text` both drop the pill and stay
 *  two: `bare` is a value on a white card (caption, ink hover), `text` a value on a body-type
 *  settings or editor row (the menu-hover fill). */
const TRIGGER_FACE = {
  bare: BARE_TRIGGER_FACE,
  flat: cn(
    "border border-border-strong bg-bg-inset px-2.5 py-1 text-caption font-medium text-text-secondary",
    "transition-colors hover:bg-surface-raised-2 hover:text-text-primary"
  ),
  raised: "auth-btn-3d-light h-9 px-3 text-body font-medium text-text-primary",
  /** The page header's white pill beside the ink page action (the ontology board's display). */
  pill: cn(WHITE_PILL, "px-3.5"),
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

/** `bare`'s chevron is the affordance, so it is not the ink. */
const CHEVRON_FACE: Partial<Record<keyof typeof TRIGGER_FACE, string>> = {
  bare: "text-text-muted",
};

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
  /** Width override for the menu. Omit it: the kit fits the menu to its options, floored at
   *  this trigger's width (`popover-menu.tsx` header). */
  menuClassName?: string;
}) {
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [anchor, setAnchor] = useState<{ x: number; y: number; width: number } | null>(null);
  const selected = options.find((o) => o.value === value) ?? options[0];

  function toggle() {
    if (anchor) {
      setAnchor(null);
      return;
    }
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) setAnchor({ x: rect.left, y: rect.bottom + 4, width: rect.width });
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
        <span className={cn("min-w-0 truncate", variant !== "bare" && "text-text-primary")}>
          {selected?.label ?? value}
        </span>
        <ChevronDown size={11} className={cn("shrink-0", CHEVRON_FACE[variant])} />
      </button>
      <Popover
        open={anchor !== null}
        at={anchor ?? undefined}
        triggerWidth={anchor?.width}
        onClose={() => setAnchor(null)}
        className={menuClassName}
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
