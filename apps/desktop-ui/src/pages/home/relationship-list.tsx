import { Bot } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { Avatar } from "@/shared/ui/avatar";
import { AvatarStack } from "@/shared/ui/avatar-stack";
import { formatChannelTimestamp } from "@/shared/lib/format-time";
import {
  channelPeople,
  channelSubline,
  channelTitle,
  hasLinkOut,
  type HomeRow,
} from "./home-rows";

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
  /** Everybody else in this channel, oldest first — empty on a link row. ⚠ The
   *  cache-shape rule for `peers` lives in `channelPeople` and nowhere else. */
  const people = row.kind === "channel" ? channelPeople(row.channel) : [];
  /** No peers and not a link: the operator and their agents, nobody else. */
  const solo = row.kind === "channel" && people.length === 0;
  /** ⚠ THE CHIP IS THE SAME FACT ON BOTH ROW KINDS — an invitation is out. A
   *  bound link says it about the channel it rides on; a legacy unbound one is
   *  the whole row. `hasLinkOut` answers for both, and since 2026-08-27 this
   *  chip is the ONLY place that fact is said on this page. */
  const linkOut = hasLinkOut(row);
  const name =
    row.kind === "channel" ? channelTitle(row.channel) : (row.link.label ?? "Link");
  const subline =
    row.kind === "channel" ? channelSubline(row.channel) : row.link.url;
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
      ) : people.length > 1 ? (
        // ⚠ TWO OR MORE PEOPLE GET A STACK, AND IT IS THE SHARED PRIMITIVE
        // (2026-08-26, F-307's fix). `shared/ui/avatar-stack.tsx` already owned
        // the overlap, the separator ring and the `+N` chip for four other
        // surfaces; what it lacked was a SIZE, so it gained one rather than this
        // page growing a fourth copy of a stack. ⚠ `size="sm"` is `Avatar
        // size="sm"` to the pixel — the branches above and below are the same
        // 32px box, or a row changes height the moment a second person joins.
        // ⚠ `max={3}` NOT the primitive's default 4: this row is 290px wide and
        // the title beside it has to stay readable. `+N` counts the HIDDEN ones.
        <div className="shrink-0" aria-hidden>
          <AvatarStack
            size="sm"
            max={3}
            users={people.map((p) => ({
              userId: p.userId,
              // ⚠ `AvatarStackUser.displayName` is NON-nullable and feeds both
              // the initials and the hover title, so the fallback happens HERE.
              // "Member" rather than "" — an empty string initials to "?" and
              // titles the face with nothing at all.
              displayName: p.displayName || p.email || "Member",
              avatarUrl: p.avatarUrl,
            }))}
          />
        </div>
      ) : (
        <Avatar
          person={
            people[0] ?? {
              // An unclaimed link has no face yet — the row id keys the
              // fallback so the generated colour is stable.
              userId: row.id,
              email: null,
              displayName: name,
              avatarUrl: null,
            }
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
