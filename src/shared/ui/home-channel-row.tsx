import { cn } from "@/shared/lib/utils";
import { formatChannelTimestamp } from "@/shared/lib/format-time";
import { AvatarStack } from "@/shared/ui/avatar-stack";
import {
  HOME_CARD_FACE,
  HOME_CARD_FACE_SELECTED,
  LinkOutChip,
  MentionBadge,
  UnreadDot,
  rowQuietInk,
} from "@/shared/ui/home-card-marks";

/**
 * ONE ROW OF /home's CHANNEL LIST — **the FACE, with every derivation already
 * done.**
 *
 * ⚠ **IT IS `apps/desktop-ui/src/pages/home/relationship-list.tsx ›
 * RelationshipRow`'s MARKUP, MOVED HERE ON 2026-09-17 — not a second row.** The
 * list still owns the column, the wells, the selection and the reads; what moved
 * is the two lines and their marks, because a SECOND host renders them: the
 * landing page's hero demo (`features/marketing/components/banner-demo/`), which
 * cannot import `apps/` at all (the root `tsconfig.json` excludes it). A
 * hand-transcribed copy of this row in the marketing tree is a look-alike that
 * drifts the first time Samuel rules on the row again — which he has done four
 * times since 2026-09-13.
 *
 * ⚠ **THE PROPS ARE ANSWERS, NOT A PAYLOAD.** `channelTitle`, `channelPeople`
 * and `hasLinkOut` stay in the SPA with `HomeRow`; this component never learns
 * what a `Channel` row is, so the marketing scene can hand it scripted facts
 * without pulling a wire type or a cache rule into the Next tree.
 *
 * 🚫 **NO DERIVATION MAY MOVE IN HERE.** The `?? EMPTY_X` cache-shape fallbacks
 * (INVARIANTS §8) belong to the reader of the cached payload, and a fallback
 * applied twice is a fallback nobody can audit.
 */

/** One face on line two. ⚠ `displayName` is NON-NULL — `AvatarStack` initials it
 *  and titles it, so the caller resolves a nameless member to their address
 *  exactly as `Avatar`'s own fallback does, never to "?". */
export interface HomeChannelRowFace {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
}

/** Everything the row says, already decided by whoever holds the data. */
export interface HomeChannelRowFacts {
  /** 🔒 **THE CHANNEL'S OWN NAME** — never derived from the roster (Samuel,
   *  2026-09-01; the rule lives on `home-rows.ts › channelTitle`). A link row has
   *  no channel yet, so it wears its label. */
  name: string;
  /** ISO — run through `formatChannelTimestamp`, the app's one channel stamp. */
  at: string;
  /** Everybody else in the channel, capped at 3 by the stack itself. EMPTY is a
   *  SOLO channel, which is what lets {@link HomeChannelRowFacts.description}
   *  take line two. */
  faces: readonly HomeChannelRowFace[];
  /** The channel's topic, or `""` when nobody wrote one. ⚠ EMPTY STAYS EMPTY —
   *  `topic` is `NOT NULL DEFAULT ''`, so this is a truthiness test downstream,
   *  not a presence one. */
  description: string;
  /** An invitation is out — the row's "Link out" chip. */
  linkOut: boolean;
  /** An unclaimed LINK row: faded title. */
  pending: boolean;
  /** A LINK row's second sentence. 🔒 **NULL FOR EVERY CHANNEL ROW** (Samuel,
   *  2026-09-13: *"having the most recent message being in there just doesn't
   *  make sense imo"*) — do not put a last-message preview back on this line. */
  pendingLine: string | null;
  /** Something here is newer than the viewer's watermark. */
  unread: boolean;
  /** Unread mentions OF THE VIEWER. `0` draws no badge. */
  mentions: number;
}

/**
 * The row.
 *
 * ⚠ **EVERY row is a RAISED BUTTON** (Samuel, 2026-08-24) — these rows ARE
 * interactive and say so. ⚠ NO `bg-*` UTILITY HERE: the kit fill is a GRADIENT
 * and a utility background flattens it (utilities outrank the kit layer).
 * ⚠ THE FACES COME BY CONSTANT (`home-card-marks.tsx`), never re-typed here.
 *
 * 🔒 **THE SELECTED ROW IS THE PAGE'S BLACK BUTTON SINCE 2026-09-15 (Samuel,
 * verbatim):** *"for the channel picker, for the selected channel, can we have it
 * turn into like the black button UI? And drop the shadow that currently goes on
 * the selected?"*
 * ⚠ **THE TWO FACES ARE ALTERNATIVES, NEVER LAYERS**, and that IS the "drop the
 * shadow": `.auth-btn-3d` sets `background`, `border` and `box-shadow` in one
 * rule, so swapping the face leaves nothing of the old selection behind. **Do not
 * re-add a ring or a module line here** — and as of 2026-09-17 there is no
 * `selected-ring` recipe left to re-add (F-713). ⚠ **SAME BOX EITHER WAY** —
 * both faces are a 1px border on this radius, so selecting a row cannot shift the
 * list.
 *
 * 🔒 ⚠ **NO IDENTITY GLYPH IN THE ROW'S LEADING SLOT (Samuel, 2026-09-01).** A
 * glyph chosen by roster size makes a channel's ICON a function of its
 * MEMBERSHIP — **a channel is not a DM and must not be dressed as one** (real DMs
 * are `channels.is_direct` / `Channel.directPeer`, untouched). ⚠ **Nor a "channel
 * avatar"**: initials from a channel's name read as a person who does not exist.
 * The row is the NAME.
 */
export function HomeChannelRow({
  row,
  selected,
  onSelect,
}: {
  row: HomeChannelRowFacts;
  selected: boolean;
  onSelect: () => void;
}) {
  /**
   * 🔒 **THE CHANNEL'S DESCRIPTION IS THE SOLO ROW'S SECOND LINE (Samuel,
   * 2026-09-15): a channel with other people in it keeps the profile icons
   * exactly as today; a channel with NOBODY else shows its description instead,
   * in italic.**
   *
   * ⚠ **THE TWO ARE ALTERNATIVES, NEVER STACKED** — they share ONE slot on line
   * two, so the row's height (which Samuel fixed: *"I like the current size of
   * it"*) cannot grow by a line.
   */
  const showDescription = row.faces.length === 0 && row.description.length > 0;

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={selected ? "true" : undefined}
      className={cn(
        selected ? HOME_CARD_FACE_SELECTED : HOME_CARD_FACE,
        "flex w-full cursor-pointer items-start gap-2.5 px-2.5 py-2.5 text-left"
      )}
    >
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          {/* ⚠ **ON THE BLACK FACE EVERY INK IS `--text-on-cta`, DIMMED — NEVER
              A SECOND COLOUR (2026-09-15).** The quiet lines below say it once,
              through `home-card-marks.tsx › rowQuietInk`. */}
          <span
            className={cn(
              "truncate text-body font-medium",
              selected
                ? row.pending
                  ? "text-text-on-cta/70"
                  : "text-text-on-cta"
                : row.pending
                  ? "text-text-secondary"
                  : "text-text-primary"
            )}
          >
            {row.name}
          </span>
          <span className={cn("shrink-0 text-micro", rowQuietInk(selected))}>
            {formatChannelTimestamp(row.at)}
          </span>
        </span>
        {/* LINE TWO — **the ROSTER on the left, the UNREAD MARKS on the right**
            (Samuel, live review 2026-09-13: the row wants "some notification
            system for new @s", at the size it already is).

            ⚠ **20px FACES — `size="2xs"`, A REAL KEY ON THE KIT COMPONENT** and
            never a class override here: `xs` (24px) grows this row, whose height
            Samuel fixed (*"I like the current size of it"*).
            ⚠ **THE TWO MARKS ARE EXCLUSIVE** — the `@ N` pill already says the
            louder version of what the dot says. */}
        <span className="mt-0.5 flex min-h-[18px] items-center gap-1.5">
          {/* ⚠ THE CHIP IS `home-card-marks.tsx › LinkOutChip` SINCE WAVE 4 —
              the workspace channel row says the same fact off the same field,
              and this markup was the only declaration of it. */}
          {row.linkOut && <LinkOutChip onDark={selected} />}
          {row.pendingLine && (
            <span className={cn("truncate text-caption", rowQuietInk(selected))}>
              {row.pendingLine}
            </span>
          )}
          {row.faces.length > 0 && (
            <span className="flex shrink-0 items-center">
              <AvatarStack
                size="2xs"
                max={3}
                users={row.faces.map((person) => ({
                  userId: person.userId,
                  displayName: person.displayName,
                  avatarUrl: person.avatarUrl,
                }))}
              />
            </span>
          )}
          {/* 🔒 **THE SOLO ROW'S DESCRIPTION (Samuel, 2026-09-15)** — the faces'
              ALTERNATIVE in this one slot; the rule lives on `showDescription`.
              ⚠ **`truncate` AND `min-w-0`, BECAUSE A DESCRIPTION IS FREE TEXT UP
              TO 2000 CHARS** (`channels/schema.ts › ChannelTopicSchema`) — it is
              the only thing on line two that could size the row, so it must clip.
              ⚠ **ITALIC IS THE RULING AND THE ONLY THING THAT MAKES IT ITALIC** —
              no second font, and the ink is `rowQuietInk` like every other quiet
              line. */}
          {showDescription && (
            <span
              className={cn(
                "min-w-0 truncate text-caption italic",
                rowQuietInk(selected)
              )}
            >
              {row.description}
            </span>
          )}
          <span className="ml-auto flex shrink-0 items-center gap-1.5">
            {row.mentions === 0 && row.unread && <UnreadDot onDark={selected} />}
            <MentionBadge count={row.mentions} onDark={selected} />
          </span>
        </span>
      </span>
    </button>
  );
}
