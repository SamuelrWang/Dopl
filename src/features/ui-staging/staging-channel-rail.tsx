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
 * DemoChannelSwitcher` (+ its `Row`). Markup and class names are identical
 * (`marketing.css › .lp-demo-sw*`); only the behaviour is staged:
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
import { HOME_CHANNEL_WELLS } from "@/features/channels/components/home-channel-wells";
import { formatChannelTimestamp } from "@/shared/lib/format-time";
import type { HomeRowMock } from "@/features/marketing/components/banner-demo/demo-home-rows";

/** Where a row goes when the page has no store to select into (see the header). */
export const STAGING_CHANNELS_HREF = "/playground/channels";

function RowBody({ row }: { row: HomeRowMock }) {
  return (
    <>
      <span className="lp-demo-sw-line">
        <span
          className="lp-demo-sw-name"
          style={row.pending ? { opacity: 0.6 } : undefined}
        >
          {row.name}
        </span>
        <span className="lp-demo-sw-time">{formatChannelTimestamp(row.at)}</span>
      </span>
      <span className="lp-demo-sw-line">
        {row.faces.length > 0 ? (
          <span className="lp-demo-sw-faces">
            {row.faces.slice(0, 3).map((f) =>
              f.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- bundled avatar
                <img
                  key={f.userId}
                  src={f.avatarUrl}
                  alt=""
                  title={f.displayName}
                  draggable={false}
                />
              ) : null
            )}
          </span>
        ) : (
          <span className="lp-demo-sw-desc">{row.pendingLine ?? row.description}</span>
        )}
        <span className="lp-demo-sw-marks">
          {row.unread && row.mentions === 0 && (
            <span className="lp-demo-sw-dot" aria-label="Unread messages" />
          )}
          {row.mentions > 0 && (
            <span
              className="lp-demo-sw-pill lp-demo-sw-pill--ink"
              title={`${row.mentions} unread mention${row.mentions === 1 ? "" : "s"}`}
            >
              @ {row.mentions}
            </span>
          )}
          {row.invited && <span className="lp-demo-sw-pill">Invited</span>}
        </span>
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
    className: "lp-demo-sw-row",
    "data-selected": selected ? "true" : undefined,
  };
  if (onSelect) {
    return (
      <div
        role="button"
        tabIndex={0}
        onClick={onSelect}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onSelect();
          }
        }}
        style={{ cursor: "pointer" }}
        {...shared}
      >
        <RowBody row={row} />
      </div>
    );
  }
  return (
    <Link href={href} {...shared}>
      <RowBody row={row} />
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
