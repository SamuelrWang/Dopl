import { useMemo } from "react";
import { HomeChannelRow } from "@/shared/ui/home-channel-row";
// App → feature import (allowed); the well cannot live in `shared/` (`collapse-wells.tsx` says why).
import {
  WellsColumn,
  type WellItem,
} from "@/features/channels/components/collapse-wells";
import { channelRowFaces } from "@/features/channels/lib/channel-display";
import { PANEL_WELL_ON_PANEL } from "@/shared/ui/panel-well";
import { channelPeople, channelTitle, hasLinkOut, type HomeRow } from "./home-rows";
import {
  HOME_CHANNEL_WELLS,
  HOME_CHANNEL_WELLS_KEY,
  channelWellOf,
  type HomeChannelWellId,
} from "./channel-wells";

/**
 * Home's left pane: the channel list as three collapsible gray wells — Pinned, Recent (last 24h)
 * and Earlier. The box is `collapse-wells.tsx`, the set and the 24h cut are `channel-wells.ts`, the
 * pin is `Channel.myFavoritedAt` (the header toggle patches the entry this column reads; no
 * per-device mirror). It renders `rows`; it does not narrow them.
 */
export function RelationshipList({
  rows,
  selectedId,
  onSelect,
}: {
  /** Every row the operator has. */
  rows: HomeRow[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  /** Filed, never re-ordered: `homeRows`' newest-first order survives inside each well. */
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
    // `--home-list-w`, shared with the header cell so the selector lands on the pane's left edge.
    <div className="flex w-[var(--home-list-w)] shrink-0 flex-col">
      <div className="flex flex-1 flex-col gap-2 overflow-y-auto px-3 pb-3 pt-1">
        {/* The empty sentence sits beside the (always drawn) wells: empty boxes cannot say which
            emptiness this is. */}
        <WellsColumn
          wells={HOME_CHANNEL_WELLS}
          items={filed}
          storageKey={HOME_CHANNEL_WELLS_KEY}
          // Collapses survive navigation and reset on restart (Samuel's ruling); the tabs keep "device".
          store="session"
          // The Agents tab's well; only the fill differs, because this `<main>` is already
          // `bg-home-panel` and `PANEL_WELL` would vanish on it.
          face={PANEL_WELL_ON_PANEL}
          // All three always drawn: they are the column's structure.
          showEmpty
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
  // The derivation only; the face is `shared/ui/home-channel-row.tsx › HomeChannelRow`, shared with
  // the landing demo. Do not re-inline the markup.
  const pending = row.kind === "link";
  /** "An invitation is out", on both row kinds; the only place this page says it. */
  const linkOut = hasLinkOut(row);
  /** The channel's own name; a link row has no channel yet, so it wears its label. */
  const name =
    row.kind === "channel" ? channelTitle(row.channel) : (row.link.label ?? "Link");
  // No last-message preview on a channel row (it is not on the wire); only a link row has line two.
  const pendingLine = row.kind === "link" ? "Not yet claimed" : null;
  // `?? EMPTY_X` inline at every new key (INVARIANTS §8), here with the cache reader, never in
  // `HomeChannelRow`. `?? 0` hides the pill rather than printing `@ NaN`.
  const channel = row.kind === "channel" ? row.channel : null;
  const mentions = channel?.mentionCount ?? 0;
  const unread = channel?.unread ?? false;
  // `channelPeople` is the one read of `peers`; `channelRowFaces` is the workspace row's mapping too.
  const faces = channelRowFaces(channel ? channelPeople(channel) : []);
  // `topic` is `""` when unset (`NOT NULL DEFAULT ''`); `?? ""` for the persisted payload (§8).
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
