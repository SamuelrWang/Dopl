import { useMemo } from "react";
import { HomeChannelRow } from "@/shared/ui/home-channel-row";
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
import { useHomeChannelSync } from "./use-home-channel-sync";
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
 *     cache by `use-home-channel-sync.ts` (the pin, and since 2026-09-17 the name and
 *     description the Info tab edits in place). ⚠ **NOT a per-device store** — the
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
  // (Samuel, 2026-09-15) — **and since 2026-09-17 the ROW'S TITLE follows the Info
  // tab's click-to-edit rename the same way.** Those writes own the CHANNELS cache;
  // this page's list is a different payload carrying the same facts, and the bridge
  // is what tells it — `use-home-channel-sync.ts` carries the bug it fixes and why
  // it lives here.
  useHomeChannelSync();
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
  /**
   * ⚠ **THE FACE IS `shared/ui/home-channel-row.tsx › HomeChannelRow` SINCE
   * 2026-09-17, AND THIS FUNCTION IS NOW THE DERIVATION ALONE.** The two lines,
   * their marks and both card faces moved to the root tree because the landing
   * page's hero demo draws the same row and cannot import `apps/`. **Nothing
   * about the rendered row changed** — what is below is exactly the set of
   * answers the markup used to compute inline, in the same order, with the same
   * rules and the same rulings.
   * 🚫 **DO NOT RE-INLINE THE MARKUP.** A second copy of this row is a restyle
   * that lands on whichever host the next reader opened.
   */
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
   * ⚠ `?? EMPTY_X` INLINE AT EVERY NEW KEY (INVARIANTS §8): both fields are new
   * on an IndexedDB-persisted payload with a 24h `gcTime`, so the first paint
   * after this bundle ships reads entries that HAVE NEITHER. `channelPeople` is
   * the one sanctioned exception and carries its own reason.
   * ⚠ **THE FALLBACKS STAY HERE, WITH THE READER OF THE CACHE.** `HomeChannelRow`
   * takes ANSWERS and owns no `?? EMPTY_X` of its own — a fallback applied twice
   * is a fallback nobody can audit.
   */
  const channel = row.kind === "channel" ? row.channel : null;
  const mentions = channel?.unreadMentions ?? 0;
  const unread = channel?.unread ?? false;
  /**
   * ⚠ **`channelPeople` CARRIES THE STALE-CACHE MERGE**, and the raw field would
   * paint a populated channel as solo for one paint after an upgrade — which is
   * also what decides whether the description takes line two.
   * ⚠ `AvatarStack` takes a NON-NULL name and initials it; a nameless member
   * degrades to their address exactly as `Avatar`'s own fallback does, never to
   * "?" when we hold one.
   */
  const faces = (channel ? channelPeople(channel) : []).map((person) => ({
    userId: person.userId,
    displayName: person.displayName ?? person.email ?? "Member",
    avatarUrl: person.avatarUrl,
  }));
  /**
   * ⚠ **EMPTY STAYS EMPTY** — `topic` is `""` when nobody wrote one
   * (`home/types.ts`, `NOT NULL DEFAULT ''`), so the row's own test is a
   * truthiness one, not a presence one.
   * ⚠ `?? ""` INLINE (INVARIANTS §8): a new key on an IndexedDB-persisted payload.
   */
  const description = channel?.topic ?? "";

  return (
    <HomeChannelRow
      row={{
        name,
        at: row.at,
        faces,
        description,
        linkOut,
        pending,
        pendingLine,
        unread,
        mentions,
      }}
      selected={selected}
      onSelect={onSelect}
    />
  );
}
