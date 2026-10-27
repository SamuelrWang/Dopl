"use client";

/**
 * **THE SHARED LEFT-HAND CHANNEL PICKER** — the 290px (`--home-list-w`) column the
 * staging window draws beside the record pane on EVERY face, the way desktop /home
 * does: `pages/home/index.tsx` renders `<RelationshipList>` inside the one
 * `flex min-h-0 flex-1` row for all five tabs, so the picker never leaves the page
 * (Samuel, 2026-10-22: "across all five pages in the actual desktop app, the
 * left-hand channel picker and the new channel button should still be on those
 * pages as well").
 *
 * The button that HEADS this column is the top bar's "New channel" pill
 * (`staging-top-bar.tsx`, `.lp-demo-top-cell` is `var(--home-list-w)` wide), which
 * mirrors desktop `home-header.tsx`'s lead cell. It is already frame-level, so it
 * rides along on every page with this column.
 *
 * STAGING COPY of `marketing/components/banner-demo/demo-home-faces.tsx ›
 * DemoChannelSwitcher`: the column and wells keep its `.lp-demo-sw*` classes. The ROW is a
 * redesign on the product kit (`shared/ui/home-channel-row.tsx`'s face), fixed at two 20px
 * lines in every case: line two is the description, the member names or "Just you"
 * (`subline`), with the faces trailing it, so nothing hides the description and no row is
 * shorter or emptier than another. Behaviour that is staged:
 *   - a well heading toggles its well open/closed (desktop `channel-wells`; the
 *     demo pins every well at `defaultOpen`);
 *   - a row is clickable. With `onSelect` it selects in place (what `/channels`
 *     does, which owns a store). Without one it is a link to `rowHref`, because
 *     picking a channel on desktop raises the channels face
 *     (`index.tsx › onSelect` calls `setTab("channels")`); a staged face has no
 *     store to select into, so the equivalent is to go to that page.
 *
 * ⚠ One copy: `/channels` (`channels-staging/staging-channels-page.tsx`) mounts it with `onSelect`.
 * ⚠ CLIENT-ONLY: the rows print clock-relative stamps off the demo's module-load
 * clock (`demo-data.ts › minsAgo`), so the frame mounts this after hydration and
 * holds the column's width with a placeholder until then.
 */

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { HOME_CHANNEL_WELLS } from "@/features/channels/components/home-channel-wells";
import { formatChannelTimestamp } from "@/shared/lib/format-time";
import { IdentityStack } from "@/shared/ui/avatar-stack";
import { MentionBadge, UnreadDot, rowQuietInk } from "@/shared/ui/home-card-marks";
import type { HomeRowMock } from "@/features/marketing/components/banner-demo/demo-home-rows";

/** Where a row goes when the page has no store to select into (see the header). */
export const STAGING_CHANNELS_HREF = "/playground/channels";

const ROW_FACE =
  "white-card raise flex w-full cursor-pointer flex-col gap-1 border-border-subtle px-2.75 py-2.25 text-left text-inherit no-underline";
const ROW_SELECTED = "border-surface-cta bg-surface-cta";

/** Line two is never empty: the description, else who is in the channel, else that nobody else is. */
function subline(row: HomeRowMock): string {
  if (row.pendingLine) return row.pendingLine;
  if (row.description) return row.description;
  if (row.faces.length === 0) return "Just you";
  return `with ${row.faces.map((f) => f.displayName.split(" ")[0]).join(", ")}`;
}

function RowBody({ row, selected }: { row: HomeRowMock; selected: boolean }) {
  const quiet = rowQuietInk(selected);
  return (
    <>
      <span className="flex h-5 w-full items-center justify-between gap-2">
        <span
          className={cn(
            "truncate text-body",
            selected ? "font-semibold text-text-on-cta" : "font-medium text-text-primary",
            row.pending && "opacity-60"
          )}
        >
          {row.name}
        </span>
        <span className={cn("shrink-0 text-micro", quiet)}>{formatChannelTimestamp(row.at)}</span>
      </span>
      <span className="flex h-5 w-full items-center gap-1.5">
        <span className={cn("min-w-0 flex-1 truncate text-caption", quiet)}>{subline(row)}</span>
        <IdentityStack
          size={18}
          max={3}
          faces={row.faces.map((f) => ({ key: f.userId, photo: f.avatarUrl, name: f.displayName }))}
          label={row.faces.map((f) => f.displayName).join(", ")}
        />
        {row.mentions === 0 && row.unread && <UnreadDot onDark={selected} />}
        <MentionBadge count={row.mentions} onDark={selected} />
        {row.invited && (
          <span
            className={cn(
              "flex h-4.5 shrink-0 items-center rounded-full px-1.75 text-micro font-medium",
              selected ? "bg-text-on-cta/15 text-text-on-cta" : "bg-bg-inset text-text-secondary"
            )}
          >
            Invited
          </span>
        )}
      </span>
    </>
  );
}

function Row({
  row,
  selected,
  onSelect,
  href,
}: {
  row: HomeRowMock;
  selected: boolean;
  /** Selects in place (the `/channels` store). Wins over `href`. */
  onSelect?: () => void;
  href: string;
}) {
  const shared = {
    "aria-label": row.name,
    "aria-current": selected ? ("true" as const) : undefined,
    className: cn(ROW_FACE, selected && ROW_SELECTED),
  };
  const body = <RowBody row={row} selected={selected} />;
  if (onSelect) {
    return (
      <button type="button" onClick={onSelect} {...shared}>
        {body}
      </button>
    );
  }
  return (
    <Link href={href} {...shared}>
      {body}
    </Link>
  );
}

export function StagingChannelRail({
  rows,
  selectedId,
  onSelect,
  rowHref = STAGING_CHANNELS_HREF,
}: {
  rows: HomeRowMock[];
  selectedId: string;
  /** Present on a page that owns a channel store (`/channels`): rows select in
   *  place. Absent: rows link to `rowHref`. */
  onSelect?: (id: string) => void;
  rowHref?: string;
}) {
  const [open, setOpen] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(HOME_CHANNEL_WELLS.map((w) => [w.id, w.defaultOpen]))
  );
  return (
    <div className="lp-demo-sw uis-sw">
      {HOME_CHANNEL_WELLS.map((well) => {
        const items = rows.filter((r) => r.well === well.id);
        const isOpen = open[well.id] ?? well.defaultOpen;
        return (
          <section key={well.id} className="lp-demo-sw-section">
            <h3 className="lp-demo-sw-head">
              <button
                type="button"
                aria-expanded={isOpen}
                onClick={() => setOpen((o) => ({ ...o, [well.id]: !isOpen }))}
                className="uis-sw-head-btn"
              >
                {well.label}
                <ChevronDown
                  size={13}
                  strokeWidth={2}
                  aria-hidden
                  className="lp-demo-sw-caret"
                  data-open={isOpen ? "true" : undefined}
                />
              </button>
            </h3>
            {isOpen && items.length > 0 && (
              <div className="lp-demo-sw-list">
                {items.map((row) => (
                  <Row
                    key={row.id}
                    row={row}
                    selected={row.id === selectedId}
                    onSelect={onSelect ? () => onSelect(row.id) : undefined}
                    href={rowHref}
                  />
                ))}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

/** The column's WIDTH before the rail mounts, so the pane does not jump. */
export function StagingChannelRailPlaceholder(): ReactNode {
  return <div className="lp-demo-sw uis-sw" aria-hidden />;
}
