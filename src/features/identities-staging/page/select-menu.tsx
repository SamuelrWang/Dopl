"use client";

/**
 * STAGING COPY of `src/shared/ui/select-menu.tsx`, taken in verbatim (2026-10-22 tree) and then
 * given ONE new trigger face — `bare`. Copied rather than edited in place because a kit primitive
 * is shared with the whole app and a redesign has to be reviewable on one page first
 * (`identities-staging/PORTING.md` → "copy a kit primitive in before a redesign changes it").
 *
 * 🔒 **`bare` IS THE ONLY DELTA. ITEM 7: NO PILL ON A DROPDOWN** (Samuel, 2026-10-22: *"For
 * dropdowns, I don't like the pill, the dropdown with the pill… For dropdowns, it should just be
 * the arrow. We don't need the whole pill around it. It can just be an arrow, right? When I click
 * it, it drops down"*). So the trigger is the VALUE plus a chevron, and nothing else: no border,
 * no fill, no radius that shows.
 *
 * 🔒 **AND IT CARRIES ITEM 7's SECOND RULING: NO `--bg-inset` ON THIS PAGE** (*"I don't like that
 * gray color. I actually want to not use that gray color at all. That's what you see in the
 * background of the search identities button"*). `flat` — the face every one of these controls
 * wore — IS that grey (`bg-bg-inset`, `#f1f1f1`). `bare` has no fill at all, so the ban is kept by
 * construction rather than by a rule somebody has to remember.
 *
 * Why not the kit's existing `text` face, which is also pill-free: it is the SETTINGS-ROW face
 * (`text-body font-normal`, a `--menu-item-hover-bg` grey hover box, and its own docblock saying
 * "Settings rows only: on a card a bare label reads as unstyled text"). These triggers sit in a
 * page toolbar at caption size, and their hover must not be a grey box.
 *
 * PORT TARGET: add `bare` to the kit's own `TRIGGER_FACE` and delete this copy. It is one more
 * entry in a record that already states the rule these faces follow ("each variant owns its whole
 * trigger face… so faces never compose"), so there is nothing to reconcile.
 */

import { useRef, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { MenuItem, Popover } from "@/shared/ui/popover-menu";
import type { SelectMenuOption } from "@/shared/ui/select-menu";

export type { SelectMenuOption };

/** Trigger faces, whole: alternatives, not layers (the kit's own rule, kept verbatim). */
const TRIGGER_FACE = {
  /**
   * NO CHROME: the value in ink, the chevron muted beside it. The chevron is then the only thing
   * that says "menu", so it may not be dropped, and the hover is INK ONLY — a fill of any shade
   * here is the pill coming back in a lighter colour.
   */
  bare: cn(
    "px-0 py-0 text-caption font-medium text-text-primary",
    "transition-colors hover:text-text-secondary disabled:hover:text-text-primary",
    // A control with no box still needs a focus mark: the kit's own, off `.search-expand-toggle`.
    "outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-text-primary"
  ),
  flat: cn(
    "border border-border-strong bg-bg-inset px-2.5 py-1 text-caption font-medium text-text-secondary",
    "transition-colors hover:bg-surface-raised-2 hover:text-text-primary"
  ),
} as const;

/** The chevron's own colour, per face: in `bare` it is the affordance, so it is not the ink. */
const CHEVRON_FACE: Record<keyof typeof TRIGGER_FACE, string> = {
  bare: "text-text-muted",
  flat: "",
};

export function SelectMenu<T extends string>({
  value,
  options,
  onChange,
  prefix,
  icon,
  ariaLabel,
  disabled,
  variant = "bare",
  className,
  menuClassName,
}: {
  value: T;
  options: ReadonlyArray<SelectMenuOption<T>>;
  onChange: (next: T) => void;
  /** Muted leading word inside the trigger ("Sort"). */
  prefix?: string;
  icon?: ReactNode;
  /** Accessible name for the trigger. */
  ariaLabel: string;
  disabled?: boolean;
  /** Trigger face. Defaults to `bare` HERE, which is the item 7 ruling. */
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
          "inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-md",
          "disabled:opacity-60",
          TRIGGER_FACE[variant],
          className
        )}
      >
        {icon}
        {prefix && <span className="shrink-0 text-text-muted">{prefix}</span>}
        <span className="min-w-0 truncate">{selected?.label ?? value}</span>
        <ChevronDown size={11} className={cn("shrink-0", CHEVRON_FACE[variant])} />
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
