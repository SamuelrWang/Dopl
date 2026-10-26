"use client";

/**
 * **THE UI-STAGING FRAME** — the landing hero's demo window (`marketing/components/
 * banner-demo/`), made clickable and emptied of the scripted channel scene, so a
 * staged copy of one desktop /home face can sit in its record pane.
 *
 * What is REUSED BY IMPORT (not copied):
 *   - `marketing.css` — every `.lp-demo-*` rule (canvas, /home slab, rail, gray
 *     panel, record pane, top bar, channel switcher);
 *   - `banner-demo/demo-home-faces.tsx › DemoChannelSwitcher` (+ the demo's rows);
 *   - `banner-demo/demo-home-rows.ts › VIEWER`;
 *   - `banner-demo/demo-steps.ts › CANVAS_W` (the desktop window width, 1280).
 * What is COPIED: `DemoTopBar` → `./staging-top-bar.tsx` (needs a selectable,
 * clickable tab, the product search pill and a live profile pill); `DemoAccountRail` →
 * `./staging-account-rail.tsx` (a live "+"). The stage around the window → `./staging.css`.
 *
 * POPUPS: every frame trigger (New channel, search, profile, the rail's "+", toast clicks)
 * opens its staged popup through `./staging-popups-provider.tsx`, mounted here once, so each
 * page gets them for free. Children can open the same popups with `useStagingPopups()`.
 *
 * ⚠ SCALE: the hero scales its 1280px design canvas to the slot. Here the scale is
 * `min(1, windowWidth / 1280)` — 1:1 whenever the browser is wide enough, so
 * portalled popovers (which render at document scale) line up with the pane.
 * Wider than 1280 the canvas simply fills the window's width.
 */

import "@/features/marketing/marketing.css";
import "./staging.css";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { HomeTab } from "@/features/home/tabs";
import {
  HOME_ROW_ID,
  VIEWER,
  homeRowsAt,
} from "@/features/marketing/components/banner-demo/demo-home-rows";
import { CANVAS_W, STEPS } from "@/features/marketing/components/banner-demo/demo-steps";
import { StagingTopBar } from "./staging-top-bar";
import { StagingAccountRail } from "./staging-account-rail";
import {
  StagingChannelRail,
  StagingChannelRailPlaceholder,
} from "./staging-channel-rail";
import { StagingPopupsContext, useStagingPopupsState } from "./staging-popups-provider";

export interface StagingFrameProps {
  /** The staged face: what the record pane holds. */
  children: ReactNode;
  /** Which /home tab the top bar underlines. Default `ontology`; `null` for a page that is no
   *  /home face (`/playground/system`). */
  tab?: HomeTab | null;
  /**
   * Draw /home's 290px channel column left of the pane. **ON by default since
   * 2026-10-22** (Samuel: "across all five pages in the actual desktop app, the
   * left-hand channel picker and the new channel button should still be on those
   * pages as well") — desktop `pages/home/index.tsx` renders `<RelationshipList>`
   * for every tab, so the frame does too. Pass `false` only for a page that is
   * deliberately not a /home face.
   * ⚠ The column prints clock-relative timestamps; it renders after mount only,
   * so it never causes a hydration mismatch. Its width is held before then.
   */
  showChannels?: boolean;
  /** Lead pill in the top bar (desktop: "New channel"). Default: the frame's staged New channel
   *  dialog (`staging-popups-provider.tsx`); pass a handler only to replace it. */
  onNew?: () => void;
  newLabel?: string;
  /** Tab → href map for the top bar (default `STAGING_ROUTES`). */
  tabHrefs?: Partial<Record<HomeTab, string>>;
  /** Extra class on the record pane (e.g. to make it a column). */
  recordClassName?: string;
  /**
   * A face's OWN channel column, drawn where `showChannels` draws the demo's inert one
   * (e.g. `/channels`' clickable switcher). Takes precedence over `showChannels`.
   */
  channelColumn?: ReactNode;
}

export function StagingFrame({
  children,
  tab = "ontology",
  showChannels = true,
  onNew,
  newLabel,
  recordClassName,
  tabHrefs,
  channelColumn,
}: StagingFrameProps) {
  const hasColumn = channelColumn !== undefined || showChannels;
  const windowRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ scale: number; w: number; h: number } | null>(
    null
  );
  const [mounted, setMounted] = useState(false);
  const popups = useStagingPopupsState();

  useEffect(() => {
    const el = windowRef.current;
    if (!el) return;
    const fit = () => {
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return;
      const scale = Math.min(1, r.width / CANVAS_W);
      setBox({ scale, w: r.width / scale, h: r.height / scale });
    };
    fit();
    const raf = requestAnimationFrame(() => setMounted(true));
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  return (
    <StagingPopupsContext value={popups.api}>
      <div className="uis-stage">
        <div className="uis-window" ref={windowRef}>
          <div className="lp-demo">
            <div
              className="lp-demo-canvas"
              style={{
                // Before the first measure: fill the window at 1:1 (SSR paint).
                width: box ? box.w : "100%",
                height: box ? box.h : "100%",
                transform: box
                  ? `translate(-50%, -50%) scale(${box.scale})`
                  : "translate(-50%, -50%)",
              }}
            >
              <div className="lp-demo-home antialiased">
                <StagingAccountRail onCreate={() => popups.api.open("new-workspace")} />
                <main className="page-float lp-demo-panel">
                  <StagingTopBar
                    viewer={VIEWER}
                    tab={tab}
                    onNew={onNew ?? (() => popups.api.open("new-channel"))}
                    newLabel={newLabel}
                    tabHrefs={tabHrefs}
                    onProfile={() => popups.api.openSettings("account")}
                  />
                  <div className="flex min-h-0 flex-1">
                    {/* The picker, on every face (`staging-channel-rail.tsx`). A page
                        with its own store passes `channelColumn`; everyone else gets
                        the shared rail, whose rows link to `/playground/channels` the
                        way a desktop pick raises the channels face. */}
                    {channelColumn}
                    {channelColumn === undefined &&
                      showChannels &&
                      (mounted ? (
                        <StagingChannelRail
                          rows={homeRowsAt(STEPS.length - 1)}
                          selectedId={HOME_ROW_ID}
                        />
                      ) : (
                        <StagingChannelRailPlaceholder />
                      ))}
                    {/* The record pane — `.lp-demo-record` + `data-frame-skin`, as the
                        hero mounts it; the staged face renders inside. */}
                    <div
                      className={[
                        "lp-demo-record",
                        hasColumn ? "" : "uis-record-solo",
                        recordClassName ?? "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      data-frame-skin
                    >
                      {children}
                    </div>
                  </div>
                </main>
              </div>
            </div>
          </div>
        </div>
        {/* Outside the scaled canvas: see `staging-popups-provider.tsx`. */}
        {popups.overlays}
      </div>
    </StagingPopupsContext>
  );
}
