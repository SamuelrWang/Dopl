import { useMemo } from "react";
import { HomeChannelRow } from "@/shared/ui/home-channel-row";
// ⚠ AN APP READING A FEATURE COMPONENT, which is the direction /home already
// takes eleven times (`person-roster-actions.tsx`, `relationship-record.tsx`, …) and NOT the
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
 *   - the PIN — `Channel.myFavoritedAt`, i.e. `channel_members.favorited_at`,
 *     written by the channel header's own toggle. 🔒 **NO MIRROR SINCE WAVE 3
 *     (R-26 (b))**: that toggle patches `channelKeys.list().all`, which is the
 *     entry THIS column reads, so the well moves on the click with nothing in
 *     between. `use-home-channel-sync.ts` — the bridge that copied the pin, the
 *     name and the description across two caches — is DELETED with the second
 *     cache. ⚠ **NOT a per-device store** either — the one this file read for an
 *     afternoon is deleted; do not mint a second.
 *
 * ⚠ **THE "no sections to manage" NOTE ABOVE WAS ABOUT THE WORKSPACE CHANNELS
 * TREE AND STILL IS.** These wells are not folders: nothing is filed by hand
 * except a pin and nothing nests.
 *
 * 🔒 **ZERO ROWS HAS ONE CAUSE AGAIN (2026-09-17).** It had two — nothing to
 * show, or nothing MATCHING to show — and the second is DELETED with the search
 * narrowing itself (Samuel's popup ruling; `index.tsx` carries it). This column
 * shows every row the operator has, always, and the only sentence it can owe is
 * "No channels yet". `home-panes.tsx` lost the same twin in the same change.
 */
export function RelationshipList({
  rows,
  selectedId,
  onSelect,
}: {
  /** Every row the operator has — ⚠ NOT narrowed by anything since 2026-09-17. */
  rows: HomeRow[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  /** ⚠ THE ROWS ARE FILED, NEVER RE-ORDERED — `homeRows`' newest-first order
   *  survives inside each well, because the grouping pass sorts nothing. */
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
          // ⚠ **`forceOpen` STOOD HERE AND IS DELETED WITH THE NARROWING
          // (2026-09-17).** It existed for ONE case — a query whose only hit was
          // filed in the default-closed `Earlier` well (2026-09-16) — and no
          // query narrows this column any more, so the prop had no live reader.
          // `Earlier`-is-closed is the plain default again.
        />
        {rows.length === 0 && (
          <p className="px-3 py-6 text-center text-caption text-text-muted">
            No channels yet
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
   * so the marks below have nothing to say about it. ⚠ **THE PREVIEW IS NO LONGER
   * ON THE WIRE EITHER** — `HomeChannel.lastMessagePreview` left with the second
   * projection (Wave 3, R-26 (b); ledger row 22 stays open). Do not put it back
   * on the row, and do not add it back to `Channel` to do so.
   */
  const pendingLine = row.kind === "link" ? "Not yet claimed" : null;
  /**
   * ⚠ `?? EMPTY_X` INLINE AT EVERY NEW KEY (INVARIANTS §8): `mentionCount` is
   * new on an IndexedDB-persisted payload with a 24h `gcTime`, and `?? 0` hides
   * the pill rather than printing `@ NaN`. **The rule holds even though this
   * wave's cache keys are new ones** (`{scope:"account"}` is a tuple no bundle
   * has written) — a per-key migration is an argument and §8 is a rule.
   * ⚠ `channelPeople` is the one named presenter, and it spells its own `??`.
   * ⚠ **THE FALLBACKS STAY HERE, WITH THE READER OF THE CACHE.** `HomeChannelRow`
   * takes ANSWERS and owns no `?? EMPTY_X` of its own — a fallback applied twice
   * is a fallback nobody can audit.
   */
  const channel = row.kind === "channel" ? row.channel : null;
  const mentions = channel?.mentionCount ?? 0;
  const unread = channel?.unread ?? false;
  /**
   * ⚠ **`channelPeople` IS THE ONE READ OF `peers`** — a plain `?? EMPTY_PEERS`
   * since the second cache went (its docblock carries why the two-field merge is
   * retired), and what decides whether the description takes line two.
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
   * (`channels.topic`, `NOT NULL DEFAULT ''`), so the row's own test is a
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
