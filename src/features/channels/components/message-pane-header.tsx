"use client";

/**
 * THE CENTER COLUMN'S HEADER — breadcrumb, bookmark, pop-out slot, info toggle —
 * in both chromes.
 *
 * ⚠ SPLIT OUT OF `message-pane.tsx` ON 2026-09-01, at the 500-line cap, when the
 * transcript's scroll-up paging needed room in that file. Nothing inside changed
 * in the move; every ⚠ note below is that file's. It is called from
 * `message-pane.tsx` and nowhere else — the "one pane, one implementation"
 * argument that file makes is about a second PANE, not a second file.
 */

import type { ReactNode } from "react";
import { ChevronRight, PanelRight, Pin } from "lucide-react";
// ⚠ CROSS-FEATURE, AND THE SAME "SMALLER OF TWO EVILS" `agents-wells.tsx` RECORDS
// (INVARIANTS §1 forbids it; F-275 records that this tree has never obeyed the
// rule). `IDENTITY_NAME_TEXT` was exported on 2026-09-13 so a second surface could
// read the type Samuel names by POINTING AT IT; this header is the fourth reader.
import { IDENTITY_NAME_TEXT } from "@/features/agent-identities/components/identity-section";
import { cn } from "@/shared/lib/utils";
import { IconButton } from "./bits";

/**
 * THE CHANNEL NAME'S TYPE IN THIS HEADER (Samuel, 2026-09-13, over the channel
 * header): *"the dropdown and the name of the channel should be that font
 * styling"* — the /home Overview's **Credit spend** face.
 *
 * ⚠ **BY IMPORT, NEVER RE-TYPED.** A hand-written `text-title font-medium` here
 * reads identically today and drifts the day that constant moves — the exact
 * argument `agents-wells.tsx`'s heading and `overview-usage-filter.tsx`'s controls
 * already make. It was `text-body font-semibold text-text-primary`: the size goes
 * up one step and **the weight comes DOWN to `font-medium`**, which is the
 * constant's own and is deliberate, not a loss.
 *
 * ⚠ **THE DROPDOWN BESIDE IT WEARS IT TOO**, and it gets there through
 * `viewSelect`'s own `className` rather than from this file: the control is
 * `channel-single-column.tsx`'s `SelectMenu`, and a caller `className` outranks
 * `select-menu.tsx › TRIGGER_FACE.flat`'s `text-caption` inside `cn`. Stated in
 * both places would be the same instruction twice.
 *
 * ⚠ **THE POP-OUT WINDOW'S `h1` IS NOT THIS AND DOES NOT MOVE** — that chrome is
 * a window title bar over a single thread, not the channel header Samuel named.
 *
 * ⚠ **THE THREAD TITLE IS NOT THE CHANNEL NAME AND IS LEFT ALONE.** Samuel named
 * two things; R2 says change only those. In a thread the crumb's channel half
 * takes the new type and keeps its own resting ink and hover (it is a BUTTON —
 * the way back out), so `IDENTITY_NAME_TEXT`'s `text-text-primary` is overridden
 * there on purpose and only the size and weight survive.
 */

export function PaneHeader({
  channelName,
  hideChannelCrumb = false,
  threadTitle,
  infoOpen = false,
  favorited,
  popOut,
  chrome,
  viewSelect,
  transcriptFilter,
  onToggleInfo,
  onToggleFavorite,
  onExitThread,
}: {
  channelName: string;
  /**
   * SUPPRESS THE VISIBLE CHANNEL CRUMB (Samuel, 2026-09-05) — for the face that
   * now names the channel itself, the single-column INFO face and its "Name"
   * row. Printing it twice, six pixels apart, is what he was looking at.
   *
   * ⚠ **SCOPED TO ONE FACE, NEVER THE HEADER WHOLESALE.** This same header
   * serves the conversation, and there the crumb is the only thing saying which
   * room you are typing into.
   * ⚠ **VISIBLE TEXT ONLY.** The pin's accessible name still says WHICH channel
   * it pins — a control that reads "Pin" with no object is a regression for
   * exactly the readers who cannot see the pane it sits on.
   * ⚠ **IGNORED IN A THREAD**, where the crumb's first half is the way BACK out
   * of the thread and deleting it would strand the reader.
   */
  hideChannelCrumb?: boolean;
  threadTitle: string | null;
  infoOpen?: boolean;
  favorited: boolean;
  popOut?: ReactNode;
  chrome: "page" | "window";
  /**
   * THE WEB'S VIEW DROPDOWN, IN THE INFO TOGGLE'S SPOT (Samuel, 2026-09-04).
   * The phone has no room for a column beside the transcript, so the five faces
   * that column carried become one dropdown here and the toggle has nothing left
   * to toggle. ⚠ PRESENT REPLACES THE TOGGLE, it does not sit beside it: two
   * controls for one choice is the confusion this replaced.
   */
  viewSelect?: ReactNode;
  /**
   * THE TRANSCRIPT FILTER, IMMEDIATELY LEFT OF THE COLLAPSE TOGGLE (Samuel,
   * 2026-09-13: *"next to the left of the toggle bar for collapsing the right-side
   * panel, I want us to add a dropdown"*) — `transcript-filter.tsx ›
   * TranscriptFilterSelect`, built by `message-pane.tsx`, which owns the selection.
   *
   * ⚠ **A SLOT AND NOT A VALUE**, exactly like {@link popOut} and `viewSelect`: the
   * control needs the loaded ROWS and the author index to know which agents to offer,
   * and this header knows about neither and must not start to.
   * ⚠ **IT SITS RIGHT OF `popOut` AND LEFT OF THE TOGGLE**, which is the only reading
   * of the ruling that survives a thread view — both controls claim "immediately left
   * of the info toggle", and the filter is the one Samuel placed against it.
   * ⚠ **ABSENT IS THE ORDINARY CASE AND RENDERS NOTHING**: a room where no agent has
   * posted has All and People naming the same set, and the pop-out window has no
   * header controls at all.
   */
  transcriptFilter?: ReactNode;
  onToggleInfo?: () => void;
  onToggleFavorite: () => void;
  onExitThread: () => void;
}) {
  // THE POP-OUT WINDOW'S HEADER: the crumb reduced to the thread's own title,
  // and nothing else. Every control the page header carries acts on something
  // this window does not have.
  if (chrome === "window") {
    return (
      <header className="flex h-[56px] shrink-0 items-center gap-1.5 border-b border-border-default px-4">
        {/* ⚠ NO `Hash` GLYPH (Samuel, 2026-09-16). The crumb already names the
            channel and the sidebar row still carries the glyph; a second one
            here was decoration in front of a title, not a control. Removed in
            BOTH chromes so the page header and the pop-out cannot disagree. */}
        <h1 className="truncate text-body font-semibold text-text-primary">
          {threadTitle ?? channelName}
        </h1>
      </header>
    );
  }

  return (
    <header className="flex h-[56px] shrink-0 items-center gap-1 border-b border-border-default px-4">
      {/* ⚠ THE GLYPH IS GONE HERE TOO — see the window chrome above. */}
      <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1">
        {threadTitle === null ? (
          hideChannelCrumb ? null : (
            <span className={cn("truncate", IDENTITY_NAME_TEXT)}>
              {channelName}
            </span>
          )
        ) : (
          <>
            <button
              type="button"
              onClick={onExitThread}
              className={cn(
                "truncate rounded-[7px] px-1 py-0.5 transition-colors hover:bg-surface-raised-1 hover:text-text-primary",
                IDENTITY_NAME_TEXT,
                // ⚠ INK LAST — the crumb's channel half is the way OUT of the
                // thread and rests muted; only the size and weight are Samuel's
                // ruling here (see the type's docblock).
                "text-text-secondary"
              )}
            >
              {channelName}
            </button>
            <ChevronRight size={12} className="shrink-0 text-text-disabled" />
            <span className="truncate text-body font-semibold text-text-primary">
              {threadTitle}
            </span>
          </>
        )}
      </nav>
      {/* THE PIN. Stays with the crumb because it acts on what the crumb NAMES;
          the right-hand cluster acts on the pane.

          🔒 **A `Pin` GLYPH SINCE 2026-09-15 (Samuel, verbatim):** *"remove the
          pin icon that appears when i hover over the picker. instead replace the
          bookmark icon next to the channel name with the pin icon."* ⚠ **THE GLYPH
          MOVED AND THE FACT DID NOT** — same control, same
          `channel_members.favorited_at`, same write. **The pin IS the bookmark**,
          and this toggle is its only writer.
          ⚠ **THE SAME CONTROL ON BOTH SURFACES** — the workspace channels page and
          /home's record pane mount this one header (INVARIANTS §7).
          ⚠ THE LABEL NAMES THE CHANNEL and is the ACT, not the state — a
          screen-reader user in a thread needs it to say WHICH thing gets pinned,
          since the crumb reads two. ⚠ **THE KNOWLEDGE CARD KEEPS "Bookmark {name}"**
          and that is not drift: it saves a BASE, a different object with its own
          verb. `aria-pressed` and the fill come off the same boolean. */}
      {/* 🔒 **NO BUTTON FACE, AND PINNED IS A DULL YELLOW (Samuel, 2026-09-15).**
          Two changes, one control:

          ⚠ **`bare` KILLS THE ELEVATED FACE, WHICH IS THE POINT.** `active` alone
          wore `.raised-tab` — a filled, raised toggle face — so a pinned channel
          grew a button under its glyph while every other control in this header
          stayed flat. `bare` is `IconButton`'s existing "no surface at all"
          variant (it already suppresses the `active` raise as well as the resting
          hover fill, which is exactly what is wanted here), so this borrows the
          one idiom rather than adding a third pin face. **`aria-pressed` still
          carries the state** — nothing is lost but paint, and the neighbouring
          info toggle has been `bare` since 2026-08-25, so the header now reads as
          one family.

          ⚠ **THE COLOUR IS THE AFFORDANCE NOW, so it has to be a token and not a
          hex** (docs/DESIGN-SYSTEM.md). `--warning` is the palette's DARKER, duller
          yellow (`oklch(0.62 0.13 75)`) where `--caution` is the brighter one, which
          is what "dull / dark-dull yellow" names. ⚠ **IT IS ON THE SEVERITY RAMP AND
          THAT IS A DELIBERATE, NARROW EXCEPTION**: `bits.tsx › AGENT_ACCENTS` refuses
          the ramp because keying an IDENTITY off it would RANK an operator's agents,
          and there is no such reading here — a pin is one boolean with no severity to
          imply, the ramp is simply where this tree's only two yellows live, and
          minting a third would be the drift that rule is actually about.
          ⚠ **`filled` RIDES THE SAME BOOLEAN**, unchanged: a filled pin reads as
          pinned, and the outline is always drawn so the glyph does not resize
          between states.
          ⚠ **`className` LAST WINS** (`cn` is `tailwind-merge`), which is how this
          keeps its 24px box against `bare`'s 32px and puts the yellow over the
          `active` branch's `text-text-primary`. */}
      <IconButton
        icon={Pin}
        label={favorited ? `Unpin ${channelName}` : `Pin ${channelName}`}
        size={14}
        bare
        className={cn("h-6 w-6", favorited && "text-warning")}
        active={favorited}
        filled={favorited}
        onClick={onToggleFavorite}
      />
      <span className="flex-1" />
      {/* THREAD VIEW ONLY — it pops out the open thread, and the channel view
          has none. Immediately LEFT of the info toggle, same `IconButton` face
          (Samuel, 2026-08-19); it was beside the crumb until then. */}
      {threadTitle !== null && popOut}
      {transcriptFilter}
      {/* ⚠ A PANEL GLYPH, NOT AN `Info` (Samuel, 2026-08-24). The control opens
          and closes the column to its right, and `PanelRight` says that; the
          circle-i said "read about this channel", which is one tab of four
          inside it. **The LABEL stays "Channel info"** — three tests address
          this button by that name, and it is still what the column is.
          ⚠ AND IT WEARS NO BUTTON AT ALL (Samuel, 2026-08-25): `bare`, so no
          circle, no fill, no border, resting OR pressed — the glyph's colour is
          the whole affordance. **This replaced a /home-scoped 32px CIRCLE**
          (`pages/home/home.module.css`, keyed on this exact label), which is
          deleted: one control with one face on both surfaces, rather than a
          shared component and a per-page override of it. */}
      {viewSelect ?? (
        <IconButton
          icon={PanelRight}
          label="Channel info"
          bare
          active={infoOpen}
          onClick={onToggleInfo}
        />
      )}
    </header>
  );
}
