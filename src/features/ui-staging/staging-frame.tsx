"use client";

/**
 * **THE UI-STAGING FRAME** — desktop /home's shell, mounted from the PRODUCT components, inside the
 * landing hero's window on the hero's picture, so one staged face can sit in its record pane:
 *   - the account rail is `shared/layout/app-shell/account-rail-core.tsx` (its "+" opens the
 *     product's request-access gate);
 *   - the panel, header strip and record pane are `home/components/shell/home-frame.tsx`;
 *   - the header is `home/components/shell/home-header.tsx` (New channel, the face tabs, the
 *     product search pill and the Profile pill with the product Settings modal);
 *   - the channel column is the playground's own `./staging-channel-rail.tsx` (or a face's
 *     `channelColumn`), not the product list.
 * Everything reads the playground bridge (`./staging-app-bridge.ts`) as it reads main on desktop.
 *
 * POPUPS: the frame-level popups and `useStagingPopups()` are `./staging-popups-provider.tsx`.
 *
 * ⚠ SCALE: the canvas is the desktop window's 1280px, scaled by `min(1, windowWidth / 1280)` —
 * 1:1 whenever the browser is wide enough. The shell root (`app-shell.module.css › .root`) is
 * `position: fixed`, which the canvas's transform turns into "fill the canvas"; the dialogs it
 * opens portal out to the document.
 */

import "@/features/marketing/marketing.css";
import "./staging.css";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { HOME_TABS, type HomeTab } from "@/features/home/tabs";
import { HomeFrame } from "@/features/home/components/shell/home-frame";
import { HomeHeader } from "@/features/home/components/shell/home-header";
import { AccountRailCore } from "@/shared/layout/app-shell/account-rail-core";
import shell from "@/shared/layout/app-shell/app-shell.module.css";
import { toast } from "@/shared/ui/toast";
import { STAGING_WORKSPACES } from "@/features/settings-staging/settings-mock-data";
import {
  HOME_ROW_ID,
  homeRowsAt,
} from "@/features/marketing/components/banner-demo/demo-home-rows";
import { CANVAS_W, STEPS } from "@/features/marketing/components/banner-demo/demo-steps";
import { STAGING_IDENTITY, STAGING_VIEWER } from "./staging-stubs";
import { StagingChannelRail, StagingChannelRailPlaceholder } from "./staging-channel-rail";
import { StagingPopupsContext, useStagingPopupsState } from "./staging-popups-provider";
import { useStagingAppBridge } from "./staging-app-bridge";

/**
 * The playground's tabs: the product's five plus the MOCKED Tasks page, between Identities and
 * Ontology (Samuel, 2026-10-28). Playground only. The real nav is `src/features/home/tabs.ts ›
 * HOME_TABS` (web + landing) and `apps/desktop-ui/src/pages/home/home-tabs.ts` (the SPA's panes);
 * Tasks joins both when it is built.
 */
export type StagingTab = HomeTab | "tasks";

export const STAGING_TABS: ReadonlyArray<{ key: StagingTab; label: string }> = [
  ...HOME_TABS.slice(0, 4),
  { key: "tasks", label: "Tasks" },
  ...HOME_TABS.slice(4),
];

/** Each tab's PUBLIC playground route (`src/app/playground/<face>/page.tsx`). */
export const STAGING_ROUTES: Partial<Record<StagingTab, string>> = {
  overview: "/playground/overview",
  channels: "/playground/channels",
  knowledge: "/playground/knowledge",
  identities: "/playground/identities",
  tasks: "/playground/tasks",
  ontology: "/playground/ontology",
};

/** The packaged SPA inlines this mark; the web serves the same picture. */
const DOPL_MARK = "/favicons/android-chrome-512x512.png";

const VIEWER = { displayName: STAGING_VIEWER.displayName, avatarUrl: STAGING_VIEWER.avatarUrl };

export interface StagingFrameProps {
  /** The staged face: what the record pane holds. */
  children: ReactNode;
  /** Which /home tab the header selects. `null` for a page that is no /home face. */
  tab?: StagingTab | null;
  /** Draw the channel column left of the pane (desktop keeps it on every face). */
  showChannels?: boolean;
  /** The header's "New channel" handler. Default: the frame's New channel dialog. */
  onNew?: () => void;
  /** Extra class on the box the face renders into (a flex row by default). */
  recordClassName?: string;
  /** A face's OWN channel column in the list slot. Takes precedence over `showChannels`. */
  channelColumn?: ReactNode;
}

export function StagingFrame({
  children,
  tab = "ontology",
  showChannels = true,
  onNew,
  recordClassName,
  channelColumn,
}: StagingFrameProps) {
  const windowRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ scale: number; w: number; h: number } | null>(null);
  const [mounted, setMounted] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState<string | null>(null);
  const bridgeReady = useStagingAppBridge();
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

  const column =
    channelColumn !== undefined ? (
      channelColumn
    ) : !showChannels ? (
      <div className="w-3 shrink-0" />
    ) : mounted ? (
      <StagingChannelRail rows={homeRowsAt(STEPS.length - 1)} selectedId={HOME_ROW_ID} />
    ) : (
      <StagingChannelRailPlaceholder />
    );

  return (
    <StagingPopupsContext value={popups.api}>
      <div className="uis-stage">
        <div className="uis-window" ref={windowRef}>
          <div className="lp-demo">
            <div
              className="lp-demo-canvas"
              style={{
                width: box ? box.w : "100%",
                height: box ? box.h : "100%",
                transform: box
                  ? `translate(-50%, -50%) scale(${box.scale})`
                  : "translate(-50%, -50%)",
              }}
            >
              <div className={shell.root}>
                <HomeFrame
                  // Tasks has no face of its own yet: it stands on Identities' white pane.
                  face={tab === "tasks" ? "identities" : (tab ?? "overview")}
                  rail={
                    <AccountRailCore
                      workspaces={STAGING_WORKSPACES}
                      activeWorkspacePublicId={active}
                      markSrc={DOPL_MARK}
                      onNavigate={(path) =>
                        setActive(STAGING_WORKSPACES.find((w) => path.endsWith(w.publicId))?.publicId ?? null)
                      }
                    />
                  }
                  header={
                    <QueryClientProvider client={popups.client}>
                      <HomeHeader<StagingTab>
                        tabOptions={STAGING_TABS}
                        identity={STAGING_IDENTITY}
                        viewer={VIEWER}
                        onWorkspaceChanged={() => {}}
                        tab={tab ?? "overview"}
                        onTabChange={(next) => {
                          const href = STAGING_ROUTES[next];
                          if (href) window.location.assign(href);
                        }}
                        query={query}
                        onQueryChange={setQuery}
                        onSearchNavigate={(item) => toast({ title: `Staging: would open ${item.title}` })}
                        onNewChannel={onNew ?? (() => popups.api.open("new-channel"))}
                        onNavigate={(path) => toast({ title: `Staging: would navigate to ${path}` })}
                      />
                    </QueryClientProvider>
                  }
                  list={column}
                >
                  <div className={["relative flex min-w-0 flex-1", recordClassName ?? ""].join(" ")}>
                    {children}
                  </div>
                </HomeFrame>
              </div>
            </div>
          </div>
        </div>
        {bridgeReady && (
          <QueryClientProvider client={popups.client}>{popups.overlays}</QueryClientProvider>
        )}
      </div>
    </StagingPopupsContext>
  );
}
