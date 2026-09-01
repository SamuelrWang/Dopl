import { cn } from "@/shared/lib/utils";
import { formatChannelTimestamp } from "@/shared/lib/format-time";
import { channelTitle, hasLinkOut, type HomeRow } from "./home-rows";

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
 */
export function RelationshipList({
  rows,
  selectedId,
  onSelect,
}: {
  /** Already narrowed — the page's `visibleRows`. */
  rows: HomeRow[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    // ⚠ Width from `home.module.css › .page --home-list-w`, NOT a local 290:
    // the header's selector is indented by the same var so it lands on the
    // record pane's left edge. One number for both.
    <div className="flex w-[var(--home-list-w)] shrink-0 flex-col">
      {/* Rows are floating cards now — they need a gutter between them, or the
          drop shadows stack into one smudge. */}
      <div className="flex flex-1 flex-col gap-2 overflow-y-auto px-3 pb-3 pt-1">
        {rows.map((row) => (
          <RelationshipRow
            key={row.id}
            row={row}
            selected={row.id === selectedId}
            onSelect={() => onSelect(row.id)}
          />
        ))}
        {rows.length === 0 && (
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
  // ⚠ UNCHANGED BY THE 2026-09-01 IDENTITY RULING, both arms: a channel's last
  // message and a link's claim state are facts about the ROW, not about who is
  // in it. Only the roster-derived title, faces and subline were removed.
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
      {/* 🔒 ⚠ **NO AVATAR, NO STACK, NO BOT GLYPH — DELETED 2026-09-01
          (Samuel).** The row carried THREE identity faces chosen by roster size:
          a `Bot` glyph when solo, one `Avatar` with a peer, an `AvatarStack`
          with several. That made a channel's ICON a function of its MEMBERSHIP,
          which is the same defect as the member-derived title beside it — a
          channel you had been working in grew a stranger's face the moment they
          claimed a link. **A channel is not a DM and must not be dressed as
          one.** Real DMs keep their faces; their code is
          `channels.is_direct` / `Channel.directPeer`, in the channels feature,
          and nothing here ever touched it.
          ⚠ **Do not put a "channel avatar" back in its place either** —
          initials generated from a channel's name read as a person who does not
          exist, which is the one thing this list must never invent. The row is
          the NAME. */}
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
        {/* 🔒 THE SUBLINE IS GONE WITH THE FACES (2026-09-01). Every value it
            could hold was the ROSTER — the lone peer's email address, "N
            people", or the words "Just you" — so it was the member-derived
            identity a second time, in smaller type. Who is in the channel is
            answered by the Info tab's roster, beside each face and each
            address, where it can be attributed. */}
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
