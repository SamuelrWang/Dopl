"use client";

/**
 * **THE HOME TOP BAR AND CHANNEL SWITCHER, REDESIGNED FOR THE BANNER DEMO ONLY** (Samuel,
 * 2026-10-22: "the top bar (everything on the new channel button line), as well as the
 * stuff under the new channel button where the channel switchers are").
 *
 * In `docs/DESIGN-LANGUAGE.md`'s look: white surfaces, hairlines, one soft shadow, an
 * underline tab bar, quiet section headings, and every channel its own bounded white card
 * (the selected one the same card filled solid ink).
 *
 * ⚠ **THE PRODUCT-FAITHFUL VERSIONS ARE KEPT.** `demo-home-chrome.tsx › DemoHomeHeader` /
 * `DemoChannelList` still mirror /home control for control (and their tests still pin
 * that); `demo-scene.tsx` mounts these faces in their place, so reverting is one swap there.
 * Same items, same order, same positions: the five `HOME_TABS`, the three
 * `HOME_CHANNEL_WELLS` with Earlier collapsed, every row's marks. Nothing here is a
 * control: the scene is decorative and the cursor never presses the chrome.
 */

import { ChevronDown, Plus, Search } from "lucide-react";
import { HOME_TABS } from "@/features/home/tabs";
import { HOME_CHANNEL_WELLS } from "@/features/channels/components/home-channel-wells";
import { formatChannelTimestamp } from "@/shared/lib/format-time";
import type { AvatarPerson } from "@/shared/ui/avatar";
import type { HomeRowMock } from "./demo-home-rows";

/** The header: same cells as `DemoHomeHeader`, re-faced. */
export function DemoTopBar({ viewer }: { viewer: AvatarPerson }) {
  const first = (viewer.displayName ?? "").split(/\s+/)[0] || "Profile";
  return (
    <div className="lp-demo-top">
      <div className="lp-demo-top-lead">
        <span className="lp-demo-top-cell">
          <span className="lp-demo-top-new">
            <Plus size={14} strokeWidth={2.2} aria-hidden />
            New channel
          </span>
        </span>
        <span className="lp-demo-top-tabs">
          {HOME_TABS.map((tab) => (
            <span
              key={tab.key}
              className="lp-demo-top-tab"
              data-selected={tab.key === "channels" ? "true" : undefined}
            >
              {tab.label}
            </span>
          ))}
        </span>
      </div>
      <div className="lp-demo-top-trail">
        <span className="lp-demo-top-search">
          <Search size={14} strokeWidth={2} aria-hidden />
          Search…
        </span>
        <span className="lp-demo-top-profile" title="Profile">
          {viewer.avatarUrl && (
            // eslint-disable-next-line @next/next/no-img-element -- bundled avatar
            <img src={viewer.avatarUrl} alt="" draggable={false} />
          )}
          {first}
        </span>
      </div>
    </div>
  );
}

function Row({ row, selected }: { row: HomeRowMock; selected: boolean }) {
  return (
    <div className="lp-demo-sw-row" data-selected={selected ? "true" : undefined}>
      <span className="lp-demo-sw-line">
        <span className="lp-demo-sw-name">{row.name}</span>
        <span className="lp-demo-sw-time">{formatChannelTimestamp(row.at)}</span>
      </span>
      <span className="lp-demo-sw-line">
        {row.faces.length > 0 ? (
          <span className="lp-demo-sw-faces">
            {row.faces.slice(0, 3).map((f) =>
              f.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- bundled avatar
                <img key={f.userId} src={f.avatarUrl} alt="" title={f.displayName} draggable={false} />
              ) : null
            )}
          </span>
        ) : (
          <span className="lp-demo-sw-desc">{row.description}</span>
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
    </div>
  );
}

/** The channel column: same wells, same rows, same order as `DemoChannelList`. */
export function DemoChannelSwitcher({
  rows,
  selectedId,
}: {
  rows: HomeRowMock[];
  selectedId: string;
}) {
  return (
    <div className="lp-demo-sw">
      {HOME_CHANNEL_WELLS.map((well) => {
        const items = rows.filter((r) => r.well === well.id);
        // The product's per-well default; nothing toggles it in the scene.
        const isOpen: boolean = well.defaultOpen;
        return (
          <section key={well.id} className="lp-demo-sw-section">
            <h3 className="lp-demo-sw-head">
              {well.label}
              <ChevronDown
                size={13}
                strokeWidth={2}
                aria-hidden
                className="lp-demo-sw-caret"
                data-open={isOpen ? "true" : undefined}
              />
            </h3>
            {isOpen && items.length > 0 && (
              <div className="lp-demo-sw-list">
                {items.map((row) => (
                  <Row key={row.id} row={row} selected={row.id === selectedId} />
                ))}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
