/**
 * /home's CARD FACE and the channel row's two UNREAD MARKS (Samuel, live review
 * 2026-09-13).
 *
 * ⚠ **A NEW FILE RATHER THAN THREE MORE EXPORTS IN `relationship-list.tsx`, AND
 * THE FACE IS WHY.** The header bar above the list wears the SAME face the rows
 * wear (Samuel: *"where the profile image is, like a longer bar"*), and its
 * renderer is `home-settings-control.tsx` — so the constant needs a home that
 * neither of them owns. A face string copied into the second file is a restyle
 * that lands on whichever one the next reader opened, which is the defect
 * `panel-buttons.tsx › PAGE_ACTION_BTN` was extracted to fix.
 */

/**
 * THE RAISED WHITE CARD FACE every /home list-column card wears — the channel
 * rows and the header's "{Name}'s Home" bar.
 *
 * ⚠ **FACE ONLY: the ELEVATION and the RADIUS, nothing else.** Size, padding,
 * flow and behavioural states stay with the caller through `cn` — the same
 * division `panel-buttons.tsx` and `open-scale-button.tsx` hold, and the reason
 * the rows can be `items-start py-2.5` while the bar is a 36px centred line.
 *
 * ⚠ **NO `bg-*` UTILITY MAY JOIN IT.** `.auth-btn-3d-light` supplies a
 * GRADIENT fill (`docs/DESIGN-SYSTEM.md`: it is THE white-raised elevation, built
 * from the `--raised-light-*` tokens), and Tailwind's utility layer outranks the
 * kit layer — a stray `bg-bg-elevated` flattens it to nothing.
 */
export const HOME_CARD_FACE = "auth-btn-3d-light rounded-[14px]";

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
 * for it) — this one is backed by a real aggregate, `HomeChannel.unreadMentions`.
 * The BOOLEAN half of the same payload still renders as a dot, below.
 *
 * ⚠ Ink from tokens: `bg-surface-cta` / `text-text-on-cta` are the page's black
 * pill, the same pair `PAGE_ACTION_BTN` wears — never `bg-black`/`text-white`,
 * which a restyle cannot follow.
 */
export function MentionBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span
      title={`${count} unread ${count === 1 ? "mention" : "mentions"}`}
      className="flex h-[18px] shrink-0 items-center rounded-full bg-surface-cta px-1.5 text-micro font-medium text-text-on-cta"
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
 * `relationship-list.tsx`.
 *
 * ⚠ **`bg-text-primary`, NOT the sidebar's `bg-link`.** The channels sidebar's
 * dot is blue on a dark rail; this one sits on a white raised card in /home's
 * account palette, where the page's only accent is ink.
 */
export function UnreadDot() {
  return (
    <span
      aria-label="Unread messages"
      className="h-1.5 w-1.5 shrink-0 rounded-full bg-text-primary"
    />
  );
}
