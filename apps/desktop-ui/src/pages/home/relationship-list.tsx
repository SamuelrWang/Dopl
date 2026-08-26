import { Bot } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { Avatar } from "@/shared/ui/avatar";
import { SegmentedControl } from "@/shared/ui/segmented-control";
import { formatChannelTimestamp } from "@/shared/lib/format-time";
import { channelTitle, hasLinkOut, type HomeFilter, type HomeRow } from "./home-rows";

/**
 * Home's left pane — the CHANNEL list. Deliberately not the workspace channels
 * tree: one flat list, filterable, no sections to manage.
 *
 * ⚠ THE COMPONENT AND FILE ARE STILL NAMED `relationship*` (2026-08-24). The
 * server rename landed first and the client redesign is a separate wave; a
 * rename here would be churn in files that wave rewrites. What DID change is
 * only what the rows read.
 *
 * ⚠ IT RENDERS `rows`, IT DOES NOT FILTER THEM. The page owns the filter state
 * and the filtered set, because the RECORD PANE resolves its selection from the
 * same set — filtering privately here let the pane fall back to a row the list
 * was no longer showing, so typing into search left a stranger's card open.
 */
export function RelationshipList({
  rows,
  linkCount,
  selectedId,
  onSelect,
  filter,
  onFilterChange,
}: {
  /** Already filtered — the page's `visibleRows`. */
  rows: HomeRow[];
  /** Counted over ALL rows, so the tab's badge does not shrink as you type. */
  linkCount: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
  filter: HomeFilter;
  onFilterChange: (filter: HomeFilter) => void;
}) {
  const visible = rows;

  return (
    // ⚠ Width from `home.module.css › .page --home-list-w`, NOT a local 290:
    // the header's selector is indented by the same var so it lands on the
    // record pane's left edge. One number for both.
    <div className="flex w-[var(--home-list-w)] shrink-0 flex-col">
      <div className="flex flex-col gap-2.5 px-4 pb-2.5 pt-1">
        {/* Same 42px scale as the header's selector and Invite — one control
            height on this page. */}
        <SegmentedControl<HomeFilter>
          options={[
            { key: "all", label: "All" },
            { key: "links", label: "Links", count: linkCount },
          ]}
          value={filter}
          onChange={onFilterChange}
          size="lg"
        />
      </div>

      {/* Rows are floating cards now — they need a gutter between them, or the
          drop shadows stack into one smudge. */}
      <div className="flex flex-1 flex-col gap-2 overflow-y-auto px-3 pb-3 pt-1">
        {visible.map((row) => (
          <RelationshipRow
            key={row.id}
            row={row}
            selected={row.id === selectedId}
            onSelect={() => onSelect(row.id)}
          />
        ))}
        {visible.length === 0 && (
          <p className="px-3 py-6 text-center text-caption text-text-muted">
            No matches
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
  /** No peer and not a link: the operator and their agents, nobody else. */
  const solo = row.kind === "channel" && row.channel.peer === null;
  /** ⚠ THE CHIP IS THE SAME FACT ON BOTH ROW KINDS — an invitation is out. A
   *  bound link says it about the channel it rides on; a legacy unbound one is
   *  the whole row. One predicate, so the chip and the Links badge agree. */
  const linkOut = hasLinkOut(row);
  const name =
    row.kind === "channel" ? channelTitle(row.channel) : (row.link.label ?? "Link");
  // ⚠ A SOLO channel's subline is the STATIC words "Just you" (Samuel's ruling,
  // 2026-08-24) — not an agent or thread count. A count here would be a second
  // read per row for a line nobody acts on.
  const subline =
    row.kind === "channel"
      ? (row.channel.peer ? (row.channel.peer.email ?? "") : "Just you")
      : row.link.url;
  const lastLine =
    row.kind === "channel"
      ? (row.channel.lastMessagePreview ?? "No messages yet")
      : "Not yet claimed";

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={selected ? "true" : undefined}
      className={cn(
        // EVERY row is a RAISED BUTTON, the same face and the same press as the
        // header's search pill (Samuel, 2026-08-24): `.auth-btn-3d-light` gives
        // the white gradient, the hairline, the hover lift and the pressed-in
        // `:active` — these rows ARE interactive, and they now say so.
        // ⚠ NO `bg-*` UTILITY HERE. The recipe's fill is a GRADIENT and a
        // utility background would flatten it (the hazard `.raised-tab`'s note
        // spells out: utilities outrank the kit layer).
        "auth-btn-3d-light flex w-full cursor-pointer items-start gap-2.5 rounded-[14px] px-2.5 py-2.5 text-left",
        // Selection is a RING, not a fill and no longer a black line (Samuel,
        // 2026-08-24): the same darkened hairline + soft halo the search pill
        // wears while it is open, held permanently. It rides ON the raised face
        // rather than replacing it, so a selected row stays the same KIND of
        // thing as its neighbours — just the one you are in.
        selected && "selected-ring"
      )}
    >
      {/* ⚠ A SOLO CHANNEL GETS A GLYPH, NOT A FACE (Samuel, 2026-08-24). It has
          no second member, and initials generated from the CHANNEL's name read
          as a person who does not exist — the one thing this list must never
          invent. An unclaimed LINK keeps the faceless avatar: somebody is
          coming, they just have not arrived.
          ⚠ `w-8 h-8` matches `Avatar size="sm"` exactly, or rows with and
          without a peer sit at two heights. */}
      {solo ? (
        <span
          aria-hidden
          className="btn-light flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-text-secondary"
        >
          <Bot size={15} />
        </span>
      ) : (
        <Avatar
          person={
            row.kind === "channel" && row.channel.peer
              ? {
                  userId: row.channel.peer.userId,
                  email: row.channel.peer.email,
                  displayName: row.channel.peer.displayName,
                  avatarUrl: row.channel.peer.avatarUrl,
                }
              : // An unclaimed link has no face yet — the row id keys the
                // fallback so the generated colour is stable.
                { userId: row.id, email: null, displayName: name, avatarUrl: null }
          }
          size="sm"
          className={cn(pending && "opacity-55")}
        />
      )}
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <span
            className={cn(
              "truncate text-body font-medium",
              pending ? "text-text-secondary" : "text-text-primary"
            )}
          >
            {name}
          </span>
          <span className="shrink-0 text-micro text-text-muted">
            {formatChannelTimestamp(row.at)}
          </span>
        </span>
        <span className="block truncate text-caption text-text-muted">
          {subline}
        </span>
        <span className="mt-0.5 flex items-center gap-1.5">
          {linkOut && (
            <span className="shrink-0 rounded-full border border-border-strong bg-bg-inset px-1.5 text-micro font-medium text-text-secondary">
              Link out
            </span>
          )}
          <span className="truncate text-caption text-text-muted">{lastLine}</span>
        </span>
      </span>
    </button>
  );
}
