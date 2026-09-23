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
 * ⚠ THREE TRIGGER FACES (four strings — `raisedField` is `raised` at row height), AND EACH
 * OWNS ITS WHOLE FACE (`variant`). `text` is the settings-row face: no pill, no underline,
 * REGULAR weight — just the label, the chevron and a GRAY HOVER (Samuel, 2026-09-06;
 * unbolded and un-underlined 2026-09-10; `--menu-item-hover-bg` added 2026-09-13). `flat` is the
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
    "border border-border-strong bg-bg-inset px-2.5 py-1 text-caption font-medium text-text-secondary",
    "transition-colors hover:bg-surface-raised-2 hover:text-text-primary"
  ),
  raised: "auth-btn-3d-light h-9 px-3 text-body font-medium text-text-primary",
  /**
   * `raised` AT FIELD-ROW HEIGHT (Samuel, 2026-08-27) — the composer panels' Identity and Model
   * rows.
   *
   * ⚠ A SIZE OF THE SAME FACE, NOT A FORK. It is `auth-btn-3d-light` exactly as `raised` is, so
   * the elevation cannot drift; only the box shrinks. ⚠ IT EXISTS BECAUSE THE FIELD CARD OWNS THE
   * ROW HEIGHT: a `h-9` trigger inside a `py-2.5` card makes that one row ~56px while every text
   * row beside it is ~40px, and a form whose rows are two heights reads as broken alignment
   * rather than as two kinds of control. `h-6` + `text-small` is what fits the card's own line box
   * with the card's padding left intact.
   */
  raisedField: "auth-btn-3d-light h-6 px-2 text-small font-medium text-text-primary",
  /**
   * NO PILL AT ALL (Samuel, 2026-09-06): "the dropdowns aren't pills anymore but just the text
   * and an arrow." This is what every dropdown on a SETTINGS row wears — Agent Settings, the
   * channel's agent rows, the thread settings tab. No border, no fill, no padding, so it sits
   * on the row's own baseline beside the Working Folder's plain name and the two read as one
   * vocabulary.
   *
   * ⚠ THE UNDERLINE AND THE BOLD ARE BOTH DELETED (Samuel, 2026-09-10, over the Agent
   * Settings block): "unbold these things … also remove the underline." The chevron is now
   * the ONLY hint of a menu, which is why it may never be dropped from the trigger. The
   * companion halves went on the same clock: the row NAME
   * (`settings-agent-rows.tsx › SettingRow`) and the Working Folder path
   * (`settings-desktop-rows.tsx › AgentFolderRows`).
   * ⚠ `font-normal` IS EXPLICIT HERE AND THE BASE NO LONGER CARRIES A WEIGHT. `font-medium`
   * used to live on the shared base, so a `font-normal` in a variant would have lost the
   * Tailwind same-layer fight (400 is emitted before 500); the three PILL faces each state
   * `font-medium` themselves instead, byte-identical in effect to what they rendered.
   *
   * ⚠ **AND IT HIGHLIGHTS GRAY ON HOVER (Samuel, 2026-09-13):** *"when I hover over the
   * dropdowns in the agent settings, it should have a gray highlight. Anything that can be
   * clicked."* The gray is `--menu-item-hover-bg` — THE one hover face for anything
   * clickable (DESIGN-SYSTEM's `.menu-row` row, Samuel 2026-09-10), by token and not by a
   * second spelling of `--surface-raised-1`. With no pill, no border and no fill at rest, this
   * hover is now the trigger's only face, so it may not be dropped for the chevron's reason.
   * ⚠ **`-mx-1.5 px-1.5` IS WHY THE VALUE DOES NOT MOVE.** The highlight needs a box wider
   * than the glyphs, and padding alone would shift every value 6px off the row's right rail
   * (these sit in a `justify-end` cell — `settings-agent-rows.tsx › SettingRow`); the negative
   * margin gives the padding back, so the resting layout is byte-identical to the unhovered
   * face that shipped. `rounded-md` REPLACES `rounded-none` for the same reason the menu row
   * is rounded — a square tint on a text label reads as a selection, not a hover.
   * ⚠ **AND IT IS SUPPRESSED WHILE DISABLED.** A busy write greys the trigger
   * (`disabled:opacity-60`); a control that still lights up under the cursor while inert is
   * the affordance lying about what a click would do.
   *
   * ⚠ Settings rows ONLY. Composer panels and dialogs keep `raised`/`raisedField`: there the
   * control sits on a card, not a row, and a bare label reads as unstyled text off the card.
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
          // ⚠ NO WEIGHT HERE — each variant owns its own (see `TRIGGER_FACE.text`).
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
