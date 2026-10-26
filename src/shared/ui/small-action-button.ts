import { cn } from "@/shared/lib/utils";

/**
 * THE 30px FLAT TEXT BUTTON — `--action-h-sm`, no face at rest, a raised-1 tint on hover.
 *
 * ⚠ ONE DECLARATION, THREE SURFACES. It was written out three times — the composer card's
 * Discard (`channels/components/composer-toolbar.tsx`), every popup form's Discard
 * (`shared/ui/form-dialog.tsx`), and the panel card action (`channels/components/bits.tsx ›
 * CARD_BUTTON`, text-only since 2026-09-08) — so an edit to the hover ink or the scale
 * reached one of the three. Extend it through `cn`, never by re-typing it.
 *
 * ⚠ THE SCALE IS THE TOKEN, NOT A 30. `--action-h-sm` is the small-action height every
 * control inside a popup form and along the composer's bottom row reads
 * (docs/DESIGN-SYSTEM.md); the 36px scale belongs to the PAGE buttons that open one
 * (`channels/components/bits.tsx › TAB_ACTION`).
 */
export const SMALL_TEXT_BUTTON =
  "flex h-[var(--action-h-sm)] items-center rounded-[8px] px-2.5 text-caption font-medium " +
  "text-text-secondary transition-colors hover:bg-surface-raised-1 hover:text-text-primary";

/**
 * THE INK PILL FACE — flat `bg-surface-cta` on the `.raise-ink` lift, the identity look's one black
 * pill (New channel, Open thread). Every black pill below is this face at a scale; extend it
 * through `cn`, never by re-typing it.
 */
export const INK_PILL_FACE =
  "raise-ink inline-flex flex-none cursor-pointer items-center rounded-full bg-surface-cta " +
  "font-medium text-text-on-cta";

/** The ink pill at a card's 26px action scale ("Open thread"). */
export const INK_PILL = cn(INK_PILL_FACE, "h-6.5 px-2.75 text-caption");

/**
 * The quiet twin of {@link INK_PILL}: a subtle hairline, no fill, secondary ink that darkens on
 * hover ("Launch agent" beside "Open thread", "See all" on the tasks quick view).
 */
export const QUIET_PILL =
  "inline-flex h-6.5 flex-none items-center rounded-full border border-border-subtle px-2.75 " +
  "text-caption font-medium text-text-secondary transition-colors hover:text-text-primary " +
  "disabled:opacity-60";

/**
 * THE 30px BLACK VERB — `.auth-btn-3d` at `--action-h-sm`, the popup form's primary
 * (`form-dialog.tsx › FormDialog`'s footer: New channel, Add person, New agent). It was that file's
 * private `PRIMARY_BTN` and moved here verbatim (Samuel, 2026-09-28: the profile popup's black
 * buttons were "too big … The other should be a smaller version"), so the popup panes wear the
 * same string, not a copy. The 36px `PAGE_ACTION_BTN` stays with the page buttons ("New channel").
 * Face and scale only; disabled states and width stay with the caller.
 */
export const SMALL_PRIMARY_BUTTON =
  "auth-btn-3d flex h-[var(--action-h-sm)] items-center rounded-[8px] px-3.5 text-caption " +
  "font-semibold text-text-on-cta";

/**
 * The 30px black verb as a pill: the profile popup's black buttons (Pair, Save, Save changes, the
 * plan buttons) on {@link INK_PILL_FACE}. The popup FORMS (`form-dialog.tsx`: New channel, Add
 * person, New agent) keep {@link SMALL_PRIMARY_BUTTON}.
 */
export const SMALL_PRIMARY_PILL = cn(INK_PILL_FACE, "h-[var(--action-h-sm)] px-3.5 text-caption");

/**
 * THE IDENTITY LOOK'S OUTLINED PILL (DESIGN-LANGUAGE §4, the secondary pill on a white card):
 * hairline, white, caption type, a raised-1 tint on hover. Content-height; a caller that sits it on
 * a fixed-height row sets the height through `cn`.
 */
export const PILL_BUTTON =
  "inline-flex flex-none items-center rounded-full border border-border-default bg-bg-overlay px-2.5 py-0.5 " +
  "text-caption font-medium text-text-primary transition-colors hover:bg-surface-raised-1";
