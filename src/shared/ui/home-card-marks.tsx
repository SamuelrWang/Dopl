import { cn } from "@/shared/lib/utils";

/**
 * /home's CARD FACE and the channel row's two UNREAD MARKS (Samuel, live review
 * 2026-09-13).
 *
 * ⚠ **A MODULE OF ITS OWN RATHER THAN THREE MORE EXPORTS ON THE LIST, AND THE
 * FACE IS WHY.** More than one /home renderer wears it — the channel rows, the
 * list skeleton's ghost bars — so the constant needs a home that none of them
 * owns. A face string copied into the second file is a restyle that lands on
 * whichever one the next reader opened, which is the defect
 * {@link "@/shared/ui/page-action-button"} was extracted to fix.
 *
 * ⚠ **IT MOVED OUT OF `apps/desktop-ui/src/pages/home/channel-row-marks.tsx` ON
 * 2026-09-17, AND THE REASON IS A SECOND TREE.** The landing page's hero demo
 * renders /home's own chrome (`features/marketing/components/banner-demo/`) and
 * the Next tree cannot import `apps/` at all. apps → root `src/` is the
 * direction that works, so the one declaration lives here and
 * `channel-row-marks.tsx` re-exports it under every name it used to declare.
 * **Nothing about any of the four faces changed in the move.**
 */

/**
 * THE RAISED WHITE CARD FACE every /home list-column card wears.
 *
 * ⚠ **FACE ONLY: the ELEVATION and the RADIUS, nothing else.** Size, padding,
 * flow and behavioural states stay with the caller through `cn` — the same
 * division `page-action-button.ts` and `open-scale-button.tsx` hold, and the
 * reason the rows can be `items-start py-2.5` while a bar is a 36px centred
 * line.
 *
 * ⚠ **NO `bg-*` UTILITY MAY JOIN IT.** `.auth-btn-3d-light` supplies a
 * GRADIENT fill (`docs/DESIGN-SYSTEM.md`: it is THE white-raised elevation, built
 * from the `--raised-light-*` tokens), and Tailwind's utility layer outranks the
 * kit layer — a stray `bg-bg-elevated` flattens it to nothing.
 */
export const HOME_CARD_FACE = "auth-btn-3d-light rounded-[14px]";

/**
 * THE SAME CARD, SELECTED — **the page's black button face** (2026-09-15).
 *
 * 🔒 **SAMUEL, verbatim:** *"for the channel picker, for the selected channel,
 * can we have it turn into like the black button UI? And drop the shadow that
 * currently goes on the selected?"*
 *
 * ⚠ **`.auth-btn-3d` BY REFERENCE, THE SAME RECIPE `page-action-button.ts ›
 * PAGE_ACTION_BTN` WEARS** — the "New channel" pill at the head of that very
 * column. Not a copied gradient: the kit owns the fill, the 1px black edge, the
 * bevel and the hover, so a restyle of the page's black button follows the
 * selection with it.
 * ⚠ **IT REPLACES THE RAISED WHITE FACE OUTRIGHT, WHICH IS WHAT "drop the
 * shadow" BUYS.** The selected row used to be `HOME_CARD_FACE` **plus**
 * the kit's `.selected-ring` hairline and halo **plus** a module rule for
 * the line — three elevations arguing over one row. `.auth-btn-3d` sets
 * `background`, `border` and `box-shadow` in one rule, so nothing of the old
 * selection survives to be layered on top. **Do not re-add a ring** — the kit
 * recipe itself was DELETED on 2026-09-17, its last reader having been this one
 * (Samuel: *"sure delete it"*; F-713).
 * ⚠ **SAME BOX, SO THE LIST DOES NOT SHIFT** — both faces are a 1px border and
 * this radius; only the paint changes.
 * ⚠ **THE INK TRAVELS WITH IT**: `text-text-on-cta`, the token `PAGE_ACTION_BTN`
 * uses and never `text-white`. Everything else on the row that was muted ink
 * dims the SAME token instead of naming a second colour — see
 * {@link rowQuietInk}, and {@link MentionBadge}/{@link UnreadDot} below, which
 * invert rather than vanish.
 */
export const HOME_CARD_FACE_SELECTED =
  "auth-btn-3d rounded-[14px] text-text-on-cta";

/**
 * A QUIET LINE'S INK ON EITHER FACE — `--text-on-cta` at an alpha on the black
 * selected card, `--text-muted` on the white one (2026-09-15).
 *
 * ⚠ **ONE on-dark ink token exists in either token file (measured:
 * `--text-on-cta`), so a quieter line DIMS it and never names a grey the palette
 * does not have** — the idiom `channels/components/agents-tab.tsx` already holds.
 * ⚠ **STATED ONCE BECAUSE THREE LINES READ IT** — the row's timestamp, its
 * pending line and a solo channel's description (`home-channel-row.tsx`). A
 * fourth spelling of the ternary is how one of them comes to dim differently.
 */
export function rowQuietInk(selected: boolean): string {
  return selected ? "text-text-on-cta/70" : "text-text-muted";
}

/**
 * THE `@ N` PILL — unread mentions of the viewer in this channel (Samuel: the
 * row should have "some notification system for new @s").
 *
 * ⚠ **HIDDEN AT ZERO, never a `0` pill.** A badge is a claim that something is
 * waiting; an inked `@ 0` is that claim made falsely, in the most eye-catching
 * ink the palette has.
 *
 * ⚠ **IT IS A COUNT, WHICH IS WHY IT MAY BE A BADGE AT ALL.** The channels
 * sidebar deliberately has no numeric badge (`channels/components/sidebar-rows.tsx`:
 * `Channel.unread` is a BOOLEAN and the wiring plan forbids inventing a number
 * for it) — this one is backed by a real aggregate, `Channel.mentionCount`.
 * The BOOLEAN half of the same payload still renders as a dot, below.
 *
 * ⚠ Ink from tokens: `bg-surface-cta` / `text-text-on-cta` are the page's black
 * pill, the same pair `PAGE_ACTION_BTN` wears — never `bg-black`/`text-white`,
 * which a restyle cannot follow.
 *
 * ⚠ **`onDark` INVERTS THE PAIR RATHER THAN DIMMING IT (2026-09-15).** The
 * SELECTED row is the black button face now ({@link HOME_CARD_FACE_SELECTED}),
 * and a black pill on a black card is not a quiet badge — it is an invisible
 * one. The two tokens simply swap roles, so the loudest mark on the page stays
 * the loudest mark on the page and no third colour is minted.
 */
export function MentionBadge({
  count,
  onDark = false,
}: {
  count: number;
  /** The row wears the black face — see the ruling above. */
  onDark?: boolean;
}) {
  if (count <= 0) return null;
  return (
    <span
      title={`${count} unread ${count === 1 ? "mention" : "mentions"}`}
      className={cn(
        "flex h-[18px] shrink-0 items-center rounded-full px-1.5 text-micro font-medium",
        onDark
          ? "bg-text-on-cta text-surface-cta"
          : "bg-surface-cta text-text-on-cta"
      )}
    >
      @ {count}
    </span>
  );
}

/**
 * THE PLAIN UNREAD DOT — something here is newer than the viewer's watermark,
 * and none of it tags them.
 *
 * ⚠ **IT IS THE `@ N` PILL'S ALTERNATIVE, NOT ITS COMPANION** (the design's own
 * rule): a channel with unread mentions already says the louder thing, and two
 * markers for one fact reads as two facts. The caller decides — see
 * `home-channel-row.tsx`.
 *
 * ⚠ **`bg-text-primary`, NOT the sidebar's `bg-link`.** The channels sidebar's
 * dot is blue on a dark rail; this one sits on a white raised card in /home's
 * account palette, where the page's only accent is ink.
 * ⚠ **AND `bg-text-on-cta` ON THE SELECTED ROW (2026-09-15)**, for
 * {@link MentionBadge}'s reason: the row is the black button face there, and ink
 * on ink is a mark nobody can see.
 */
export function UnreadDot({ onDark = false }: { onDark?: boolean }) {
  return (
    <span
      aria-label="Unread messages"
      className={cn(
        "h-1.5 w-1.5 shrink-0 rounded-full",
        onDark ? "bg-text-on-cta" : "bg-text-primary"
      )}
    />
  );
}
