import { useMemo } from "react";
import { cn } from "@/shared/lib/utils";
import { formatChannelTimestamp } from "@/shared/lib/format-time";
import { AvatarStack } from "@/shared/ui/avatar-stack";
// ⚠ AN APP READING A FEATURE COMPONENT, which is the direction /home already
// takes eleven times (`person-members.tsx`, `person-info-tab.tsx`, …) and NOT the
// feature→feature import INVARIANTS §1 forbids. The well's machinery cannot live
// in `shared/` while its heading face lives in `agent-templates` —
// `collapse-wells.tsx`'s own import comment carries that argument.
import {
  WellsColumn,
  type WellItem,
} from "@/features/channels/components/collapse-wells";
import { PANEL_WELL_ON_PANEL } from "@/shared/ui/panel-well";
import { channelPeople, channelTitle, hasLinkOut, type HomeRow } from "./home-rows";
import {
  HOME_CARD_FACE,
  HOME_CARD_FACE_SELECTED,
  MentionBadge,
  UnreadDot,
  rowQuietInk,
} from "./channel-row-marks";
import { useHomeFavoriteSync } from "./use-home-favorite-sync";
import {
  HOME_CHANNEL_WELLS,
  HOME_CHANNEL_WELLS_KEY,
  channelWellOf,
  type HomeChannelWellId,
} from "./channel-wells";

/**
 * Home's left pane — the CHANNEL list. Deliberately not the workspace channels
 * tree: one flat list, no sections to manage.
 *
 * ⚠ THE COMPONENT AND FILE ARE STILL NAMED `relationship*` (2026-08-24). The
 * server rename landed first and the client redesign is a separate wave; a
 * rename here would be churn in files that wave rewrites. What DID change is
 * only what the rows read.
 *
 * ⚠ NO CONTROLS OF ITS OWN SINCE 2026-08-27 (Samuel: the "All | Links"
 * segmented filter is deleted — links are no longer a filterable state). The
 * column is the SCROLLER and nothing above it; the only narrowing left is the
 * header's search field, which the page owns. **Do not put a control strip back
 * here** — a row with an open invitation still says so on the row, in the "Link
 * out" chip.
 *
 * ⚠ IT RENDERS `rows`, IT DOES NOT NARROW THEM. The page owns the search query
 * and the narrowed set, because the RECORD PANE resolves its selection from the
 * same set — narrowing privately here let the pane fall back to a row the list
 * was no longer showing, so typing into search left a stranger's card open.
 *
 * 🔒 **IT IS THREE COLLAPSIBLE GRAY WELLS SINCE 2026-09-15, NOT A FLAT COLUMN
 * (Samuel, verbatim):** *"look on the agents tab, there is the gray box, for
 * recents, 7 days, etc. I want to bring that over. Basically, one for Pinned, one
 * for Recents (this will be in effect channels with activity in the last 24
 * hours), and Earlier. Also, notice how in the agents tab, those the top gray,
 * kinda extends over the entire width. Can you make the channels one looks more
 * like a tab, meaning, it will be, Recent (arrow), then the gray drops. Each
 * corner needs to be curved."* Three parts, three owners:
 *   - the BOX and its collapse — `channels/components/collapse-wells.tsx`, the
 *     same module the Agents and Threads tabs read. ⚠ **ONE SHAPE**: the `"tab"`
 *     variant he asked for that morning was retracted the same day.
 *   - the SET and the 24h cut — `channel-wells.ts`, which asks
 *     `recency-wells.tsx › wellFor` rather than owning a second clock;
 *   - the PIN — `HomeChannel.favoritedAt`, i.e. `channel_members.favorited_at`,
 *     written by the channel header's own toggle and mirrored into this page's
 *     cache by `use-home-favorite-sync.ts`. ⚠ **NOT a per-device store** — the
 *     one this file read for an afternoon is deleted; do not mint a second.
 *
 * ⚠ **THE "no sections to manage" NOTE ABOVE WAS ABOUT THE WORKSPACE CHANNELS
 * TREE AND STILL IS.** These wells are not folders: nothing is filed by hand
 * except a pin and nothing nests.
 *
 * 🔒 **ZERO ROWS HAS TWO CAUSES AND THEY ARE NOT THE SAME SENTENCE (2026-09-10)**
 * — nothing to show, or nothing MATCHING to show. `home-panes.tsx` draws the same
 * distinction for the RECORD PANE, keyed on the same value, so the two surfaces
 * cannot disagree.
 */
export function RelationshipList({
  rows,
  totalRows,
  selectedId,
  onSelect,
}: {
  /** Already narrowed — the page's `visibleRows`. */
  rows: HomeRow[];
  /** ⚠ The UNNARROWED count (`homeRows`), and it is what separates the two empty
   *  sentences. Deliberately the TOTAL rather than "is a query active": with no
   *  channels at all, typing into search still means "No channels yet" — there is
   *  nothing for a filter to have excluded. This is `home-panes.tsx`'s own test
   *  (`rows.length > 0`), so the two surfaces cannot disagree. */
  totalRows: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  // 🔒 THE PIN IS THE BOOKMARK, SO THE WELL MOVES WHEN THE HEADER'S TOGGLE FIRES
  // (Samuel, 2026-09-15). That write owns the CHANNELS cache; this page's list is
  // a different payload carrying the same fact, and the bridge is what tells it —
  // `use-home-favorite-sync.ts` carries the bug it fixes and why it lives here.
  useHomeFavoriteSync();
  /** ⚠ THE NARROWED ROWS ARE FILED, NEVER RE-ORDERED — `visibleRows` has already
   *  run (the page owns it, see above) and `homeRows`' newest-first order survives
   *  inside each well, because the grouping pass sorts nothing. */
  const filed = useMemo<WellItem<HomeChannelWellId>[]>(
    () =>
      rows.map((row) => ({
        key: row.id,
        well: channelWellOf(row),
        node: (
          <RelationshipRow
            row={row}
            selected={row.id === selectedId}
            onSelect={() => onSelect(row.id)}
          />
        ),
      })),
    [rows, selectedId, onSelect]
  );
  return (
    // ⚠ Width from `home.module.css › .page --home-list-w`, NOT a local 290:
    // the header's selector is indented by the same var so it lands on the
    // record pane's left edge. One number for both.
    <div className="flex w-[var(--home-list-w)] shrink-0 flex-col">
      {/* Rows are floating cards now — they need a gutter between them, or the
          drop shadows stack into one smudge. */}
      <div className="flex flex-1 flex-col gap-2 overflow-y-auto px-3 pb-3 pt-1">
        {/* ⚠ THE EMPTY SENTENCE IS A SIBLING OF THE WELLS, AND SINCE `showEmpty`
            THE TWO ARE ON SCREEN TOGETHER — deliberate, and NOT the placeholder
            copy minimal-copy forbids: three empty boxes cannot say WHICH
            emptiness this is, and the 2026-09-10 ruling is still live. */}
        <WellsColumn
          wells={HOME_CHANNEL_WELLS}
          items={filed}
          storageKey={HOME_CHANNEL_WELLS_KEY}
          // 🔒 THE AGENTS TAB'S WELL, EXACTLY (Samuel, 2026-09-15: *"just make
          // the gray dropdowns match exactly those instead"*) — same full-width
          // header inside the box, same chevron, same collapse. ⚠ **ONLY THE FILL
          // DIFFERS, AND ONLY SO THE SAME BOX IS VISIBLE HERE**: this page's
          // `<main>` IS `bg-home-panel`, so `PANEL_WELL` would paint the page's
          // own colour (his *"there's no gray background on this at all"*).
          face={PANEL_WELL_ON_PANEL}
          // 🔒 ALL THREE ALWAYS DRAWN — *"I want there to be something there, like
          // the gray box. Basically, it will just be empty until the user actually
          // puts something in it, but I still want it to be there."* The wells are
          // this column's STRUCTURE: a **Pinned** box you can see is how you learn
          // there is a pin.
          showEmpty
          // 🔒 **A SEARCH THAT MATCHES MUST SHOW WHAT IT MATCHED** (2026-09-16). `Earlier` is
          // closed by default, so a query whose only hit was filed there rendered an EMPTY
          // column with no sentence under it — `rows.length > 0`, so neither "No matches" nor
          // "No channels yet" drew, and the matched row was unmounted behind the closed well.
          // ⚠ **DERIVED, NOT THREADED**: `rows.length < totalRows` IS "the page narrowed this
          // list", and both numbers are already props — see `totalRows`' own note. It leaves the
          // `Earlier`-is-closed default alone, which is the one part of this Samuel did not
          // state.
          forceOpen={rows.length < totalRows}
        />
        {rows.length === 0 && (
          <p className="px-3 py-6 text-center text-caption text-text-muted">
            {totalRows > 0 ? "No matches" : "No channels yet"}
          </p>
        )}
      </div>
    </div>
  );
}

function RelationshipRow({
  row,
  selected,
  onSelect,
}: {
  row: HomeRow;
  selected: boolean;
  onSelect: () => void;
}) {
  const pending = row.kind === "link";
  /** ⚠ THE CHIP IS THE SAME FACT ON BOTH ROW KINDS — an invitation is out. A
   *  bound link says it about the channel it rides on; a legacy unbound one is
   *  the whole row. `hasLinkOut` answers for both, and since 2026-08-27 this
   *  chip is the ONLY place that fact is said on this page. */
  const linkOut = hasLinkOut(row);
  /** 🔒 THE CHANNEL'S OWN NAME — `channelTitle` no longer derives one from the
   *  roster (Samuel, 2026-09-01; the rule and its history live in that
   *  function's docblock). A link row has no channel yet, so it wears its
   *  label. */
  const name =
    row.kind === "channel" ? channelTitle(row.channel) : (row.link.label ?? "Link");
  /**
   * 🔒 **NO LAST-MESSAGE PREVIEW ON A CHANNEL ROW (Samuel, 2026-09-13: *"having
   * the most recent message being in there just doesn't make sense imo"*).** Only
   * a LINK row keeps a second sentence — it has no channel, roster or read-state,
   * so the marks below have nothing to say about it. ⚠ `HomeChannel.lastMessagePreview`
   * is still on the wire and this is still its only possible renderer; do not put
   * it back on the row.
   */
  const pendingLine = row.kind === "link" ? "Not yet claimed" : null;
  /**
   * The CHANNEL row's own second line — the roster on the left, the unread marks
   * on the right.
   *
   * ⚠ `?? EMPTY_X` INLINE AT EVERY NEW KEY (INVARIANTS §8): both fields are new
   * on an IndexedDB-persisted payload with a 24h `gcTime`, so the first paint
   * after this bundle ships reads entries that HAVE NEITHER. `channelPeople` is
   * the one sanctioned exception and carries its own reason.
   */
  const channel = row.kind === "channel" ? row.channel : null;
  const mentions = channel?.unreadMentions ?? 0;
  const unread = channel?.unread ?? false;
  const faces = channel ? channelPeople(channel) : [];
  /**
   * 🔒 **THE CHANNEL'S DESCRIPTION, AND IT IS THE SOLO ROW'S SECOND LINE
   * (Samuel, 2026-09-15): a channel with other people in it keeps the profile
   * icons exactly as today; a channel with NOBODY else shows its description
   * instead, in italic.**
   *
   * ⚠ **THE TWO ARE ALTERNATIVES, NEVER STACKED** — they share ONE slot on line
   * two, so the row's height (which Samuel fixed: *"I like the current size of
   * it"*) cannot grow by a line.
   * ⚠ **`faces.length` IS THE TEST, NOT `peers.length`** — `channelPeople` carries
   * the stale-cache merge, and the raw field would paint a populated channel as
   * solo for one paint after an upgrade.
   * ⚠ **EMPTY STAYS EMPTY** — `topic` is `""` when nobody wrote one (`home/types.ts`,
   * `NOT NULL DEFAULT ''`), so this is a truthiness test, not a presence one.
   * ⚠ `?? ""` INLINE (INVARIANTS §8): a new key on an IndexedDB-persisted payload.
   */
  const description = channel?.topic ?? "";
  const showDescription = faces.length === 0 && description.length > 0;

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={selected ? "true" : undefined}
      className={cn(
        // EVERY row is a RAISED BUTTON (Samuel, 2026-08-24) — these rows ARE
        // interactive and say so. ⚠ NO `bg-*` UTILITY HERE: the kit fill is a
        // GRADIENT and a utility background flattens it (utilities outrank the
        // kit layer). ⚠ THE FACES COME BY CONSTANT (`channel-row-marks.tsx`),
        // never re-typed here.
        //
        // 🔒 **THE SELECTED ROW IS THE PAGE'S BLACK BUTTON SINCE 2026-09-15
        // (Samuel, verbatim):** *"for the channel picker, for the selected
        // channel, can we have it turn into like the black button UI? And drop
        // the shadow that currently goes on the selected?"*
        // ⚠ **THE TWO FACES ARE ALTERNATIVES, NEVER LAYERS**, and that IS the
        // "drop the shadow": `.auth-btn-3d` sets `background`, `border` and
        // `box-shadow` in one rule, so swapping the face leaves nothing of the
        // old selection behind. **Do not re-add `selected-ring` or a module
        // line here.** ⚠ **SAME BOX EITHER WAY** — both faces are a 1px border on
        // this radius, so selecting a row cannot shift the list.
        selected ? HOME_CARD_FACE_SELECTED : HOME_CARD_FACE,
        "flex w-full cursor-pointer items-start gap-2.5 px-2.5 py-2.5 text-left"
      )}
    >
      {/* 🔒 ⚠ **NO IDENTITY GLYPH IN THE ROW'S LEADING SLOT (Samuel, 2026-09-01).**
          A glyph chosen by roster size makes a channel's ICON a function of its
          MEMBERSHIP — **a channel is not a DM and must not be dressed as one**
          (real DMs are `channels.is_direct` / `Channel.directPeer`, untouched).
          ⚠ **Nor a "channel avatar"**: initials from a channel's name read as a
          person who does not exist. The row is the NAME. */}
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          {/* ⚠ **ON THE BLACK FACE EVERY INK IS `--text-on-cta`, DIMMED — NEVER
              A SECOND COLOUR (2026-09-15).** The quiet lines below say it once,
              through `channel-row-marks.tsx › rowQuietInk`. */}
          <span
            className={cn(
              "truncate text-body font-medium",
              selected
                ? pending
                  ? "text-text-on-cta/70"
                  : "text-text-on-cta"
                : pending
                  ? "text-text-secondary"
                  : "text-text-primary"
            )}
          >
            {name}
          </span>
          <span
            className={cn(
              "shrink-0 text-micro",
              rowQuietInk(selected)
            )}
          >
            {formatChannelTimestamp(row.at)}
          </span>
        </span>
        {/* LINE TWO — **the ROSTER on the left, the UNREAD MARKS on the right**
            (Samuel, live review 2026-09-13: the row wants "some notification
            system for new @s", at the size it already is).

            🔒 **THE FACES HERE DO NOT REOPEN THE 2026-09-01 RULING** — what that
            deleted was identity STANDING IN FOR THE CHANNEL (a leading glyph, a
            roster-derived title). The title is still `channelTitle` and the
            leading slot is still empty. A SOLO channel shows nothing, so there is
            no "Just you".

            ⚠ **20px FACES — `size="2xs"`, A REAL KEY ON THE KIT COMPONENT** and
            never a class override here: `xs` (24px) grows this row, whose height
            Samuel fixed (*"I like the current size of it"*).
            ⚠ **THE TWO MARKS ARE EXCLUSIVE** — the `@ N` pill already says the
            louder version of what the dot says. */}
        <span className="mt-0.5 flex min-h-[18px] items-center gap-1.5">
          {linkOut && (
            <span
              className={cn(
                "shrink-0 rounded-full border px-1.5 text-micro font-medium",
                selected
                  ? "border-text-on-cta/30 bg-text-on-cta/15 text-text-on-cta"
                  : "border-border-strong bg-bg-inset text-text-secondary"
              )}
            >
              Link out
            </span>
          )}
          {pendingLine && (
            <span
              className={cn(
                "truncate text-caption",
                rowQuietInk(selected)
              )}
            >
              {pendingLine}
            </span>
          )}
          {faces.length > 0 && (
            <span className="flex shrink-0 items-center">
              <AvatarStack
                size="2xs"
                max={3}
                users={faces.map((person) => ({
                  userId: person.userId,
                  // ⚠ `AvatarStack` takes a NON-NULL name and initials it; a
                  // nameless member degrades to their address exactly as
                  // `Avatar`'s own fallback does, never to "?" when we hold one.
                  displayName: person.displayName ?? person.email ?? "Member",
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
              {description}
            </span>
          )}
          <span className="ml-auto flex shrink-0 items-center gap-1.5">
            {mentions === 0 && unread && <UnreadDot onDark={selected} />}
            <MentionBadge count={mentions} onDark={selected} />
          </span>
        </span>
      </span>
    </button>
  );
}
