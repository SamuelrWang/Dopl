"use client";

import { useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { MenuItem, Popover } from "@/shared/ui/popover-menu";
import {
  COMPOSER_MODE_OPTIONS,
  composerModeLabel,
  type ComposerMode,
} from "../lib/composer-mode";

/** The pill's accessible-name prefix. Kept as the export the tests read. */
export const COMPOSER_MODE_LABEL = "Send as";

/**
 * THE MESSAGE / REQUEST PILL — rollback plan §3.2, the main channel's half.
 *
 * What it replaces: a `SegmentedControl` sitting in a row ABOVE the input. Two
 * always-visible tabs is a lot of chrome for a control whose resting state is
 * the boring one, and it put the thing that decides what Enter DOES a row away
 * from the thing you press Enter in. §3.2 puts both of this product's mode
 * controls in the same place instead — inside the text input, on the right —
 * so "what will this send do" is answered where the sending happens.
 *
 * IT IS A DROPDOWN, NOT A TOGGLE, and that is the point of the phase. The
 * surface being replaced across §3.2 is SYNTAX (`/new-agent`, a leading `@`),
 * whose defect was that nothing on screen said the option existed. A two-state
 * click-through has the same defect in miniature: the state you are not in is
 * invisible until you click, and here the state you are not in starts somebody
 * else's machine. The menu shows both rows, each with its consequence, before
 * anything is chosen.
 *
 * COORDINATE MODE, for the reason `AddressPicker` documents: the composer is
 * pinned to the bottom of a `.page-float`, which clips its overflow, so a
 * trigger-anchored panel renders as a clipped sliver. `at={{x,y}}` portals to
 * `<body>` and `useClampedFixedPosition` slides it back on-screen — which for a
 * control this close to the bottom edge means it opens UPWARD.
 */
export function ComposerIntentPill({
  mode,
  onChange,
  disabled,
}: {
  mode: ComposerMode;
  onChange: (next: ComposerMode) => void;
  /** Locked while a send is in flight: the mode decides what that send WAS. */
  disabled?: boolean;
}) {
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  const label = composerModeLabel(mode);

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
        aria-haspopup="menu"
        aria-expanded={anchor !== null}
        /* The visible word is INSIDE the accessible name rather than replaced by
           it: a bare aria-label would hide "Message" from the label a screen
           reader (and voice control) announces, which is the one word on the
           control that says what it is currently set to. */
        aria-label={`${COMPOSER_MODE_LABEL}: ${label}`}
        className={cn(
          /* No `self-end`: the bubble is `items-end`, so the alignment is the
             parent's and a local override would be a second opinion about it. */
          "flex shrink-0 items-center gap-1 rounded-full border border-border-strong px-2 py-1 text-caption font-medium text-text-secondary transition-colors hover:text-text-primary disabled:opacity-50",
          mode === "request" && "text-text-primary",
          /* Menu open = the raised white face; its fill replaces the resting
             one, because a `bg-*` utility outranks the kit layer and would
             flatten `.raised-tab`'s gradient. */
          anchor !== null ? "raised-tab" : "bg-bg-elevated"
        )}
      >
        {label}
        <ChevronDown size={11} className="shrink-0 text-text-muted" />
      </button>
      <Popover
        open={anchor !== null}
        at={anchor ?? undefined}
        onClose={() => setAnchor(null)}
        className="w-[260px]"
      >
        {COMPOSER_MODE_OPTIONS.map((option) => (
          <MenuItem
            key={option.key}
            active={option.key === mode}
            showCheck
            description={option.hint}
            onSelect={() => {
              onChange(option.key);
              setAnchor(null);
            }}
          >
            {option.label}
          </MenuItem>
        ))}
      </Popover>
    </>
  );
}
