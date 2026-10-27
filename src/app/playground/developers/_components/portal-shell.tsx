"use client";

/**
 * The portal's frame: desktop /home's shell composed from the PRODUCT pieces the UI-staging frame
 * mounts (`features/ui-staging/staging-frame.tsx`), inside the same hero stage and scaled 1280px
 * canvas:
 *   - the account rail is `shared/layout/app-shell/account-rail-core.tsx`;
 *   - the panel, header strip and record pane are `home/components/shell/home-frame.tsx`
 *     (`HomeFrame` + `HomeHeaderRow`), on the Overview face's surfaces;
 *   - the header's underline tabs are the portal's sections (where /home's are its faces);
 *   - the list column holds the environments as channel-picker rows (`.lp-demo-sw*`, the
 *     playground column; rows on `shared/ui/home-channel-row.tsx`'s face), which is the test/live
 *     switch.
 * `StagingFrame` itself is not used because its header is /home's (faces, search, Profile).
 */

import "@/features/marketing/marketing.css";
import "@/features/ui-staging/staging.css";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { Environment } from "@dopl/contracts/device-sdk";
import { cn } from "@/shared/lib/utils";
import { HomeFrame, HomeHeaderRow } from "@/features/home/components/shell/home-frame";
import { AccountRailCore, HOME_PATH } from "@/shared/layout/app-shell/account-rail-core";
import shell from "@/shared/layout/app-shell/app-shell.module.css";
import { CANVAS_W } from "@/features/marketing/components/banner-demo/demo-steps";
import { STAGING_WORKSPACES } from "@/features/settings-staging/settings-mock-data";
import { rowQuietInk } from "@/shared/ui/home-card-marks";
import { IDENTITY_NAME_TEXT } from "@/shared/ui/section-heading";
import { SegmentedControl } from "@/shared/ui/segmented-control";
import { StatusPill } from "@/shared/ui/status-pill";
import { DEMO_ENVS, DEMO_PROJECT } from "../_data/fixtures";
import { usePortal } from "./portal-context";
import { ov } from "./ui";

export const PORTAL_BASE = "/playground/developers";

/** Every portal section, in tab order. `connect` is the end user's screen, not a console page. */
export const PORTAL_SECTIONS = [
  { key: "overview", href: "", label: "Overview" },
  { key: "keys", href: "/keys", label: "Keys" },
  { key: "users", href: "/users", label: "Users" },
  { key: "devices", href: "/devices", label: "Devices" },
  { key: "profiles", href: "/profiles", label: "Profiles" },
  { key: "events", href: "/events", label: "Events" },
  { key: "webhooks", href: "/webhooks", label: "Webhooks" },
  { key: "test-mode", href: "/test-mode", label: "Test mode" },
  { key: "connect", href: "/connect", label: "Connect" },
] as const;

type SectionKey = (typeof PORTAL_SECTIONS)[number]["key"];

const DOPL_MARK = "/favicons/android-chrome-512x512.png";

export function PortalShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const windowRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ scale: number; w: number; h: number } | null>(null);

  // The staging frame's fit: the 1280px desktop canvas, scaled down only when the window is narrower.
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
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div className="uis-stage">
      <div className="uis-window" ref={windowRef}>
        <div className="lp-demo">
          <div
            className="lp-demo-canvas"
            style={{
              width: box ? box.w : "100%",
              height: box ? box.h : "100%",
              transform: box ? `translate(-50%, -50%) scale(${box.scale})` : "translate(-50%, -50%)",
            }}
          >
            <div className={shell.root}>
              <HomeFrame
                face="overview"
                rail={
                  <AccountRailCore
                    workspaces={STAGING_WORKSPACES}
                    activeWorkspacePublicId={null}
                    markSrc={DOPL_MARK}
                    onNavigate={(path) => path === HOME_PATH && router.push("/playground/overview")}
                  />
                }
                header={<Header />}
                list={<EnvColumn />}
              >
                <div className={ov.root}>
                  <div className={ov.inner}>{children}</div>
                </div>
              </HomeFrame>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Header() {
  const router = useRouter();
  const pathname = usePathname();
  const { env } = usePortal();
  const current = PORTAL_SECTIONS.find((s) => s.href && pathname.startsWith(PORTAL_BASE + s.href))?.key ?? "overview";
  return (
    <HomeHeaderRow
      lead={
        <span className="flex min-w-0 items-baseline gap-2">
          <span className={cn(IDENTITY_NAME_TEXT, "truncate")}>{DEMO_PROJECT.name}</span>
          <span className="font-mono text-micro text-text-muted">{DEMO_PROJECT.api_version}</span>
        </span>
      }
      tabs={
        <SegmentedControl<SectionKey>
          options={PORTAL_SECTIONS}
          value={current}
          onChange={(key) => router.push(PORTAL_BASE + (PORTAL_SECTIONS.find((s) => s.key === key)?.href ?? ""))}
          variant="underline"
          size="lg"
          ariaLabel="Developer portal"
        />
      }
      trail={
        env === "test" ? (
          <StatusPill tone="attention" dot>
            Test data
          </StatusPill>
        ) : (
          <StatusPill tone="live" dot bare>
            Live
          </StatusPill>
        )
      }
    />
  );
}

const ENV_ROWS: ReadonlyArray<{ key: Environment; label: string }> = [
  { key: "test", label: "Test" },
  { key: "live", label: "Live" },
];

/** The env switch, as the channel column's rows: the selected row is the same card in ink. */
function EnvColumn() {
  const { env, setEnv, keys } = usePortal();
  return (
    <div className="lp-demo-sw uis-sw">
      <section className="lp-demo-sw-section">
        <h3 className="lp-demo-sw-head">Environments</h3>
        <div className="lp-demo-sw-list" role="radiogroup" aria-label="Environment">
          {ENV_ROWS.map(({ key, label }) => {
            const selected = key === env;
            const quiet = rowQuietInk(selected);
            const fx = DEMO_ENVS[key];
            const users = new Set(fx.connections.map((c) => c.external_user_id)).size;
            const online = fx.devices.filter((d) => d.online).length;
            const activeKeys = (key === env ? keys : fx.keys).filter((k) => !k.revoked_at).length;
            return (
              <button
                key={key}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => setEnv(key)}
                className={cn(
                  "white-card raise flex w-full flex-col gap-1 border-border-subtle px-2.75 py-2.25 text-left",
                  selected && "border-surface-cta bg-surface-cta"
                )}
              >
                <span className="flex h-5 w-full items-center justify-between gap-2">
                  <span className={cn("truncate text-body", selected ? "font-semibold text-text-on-cta" : "font-medium text-text-primary")}>
                    {label}
                  </span>
                  <span className={cn("shrink-0 text-micro", quiet)}>
                    {activeKeys} {activeKeys === 1 ? "key" : "keys"}
                  </span>
                </span>
                <span className="flex h-5 w-full items-center gap-1.5">
                  <span className={cn("min-w-0 flex-1 truncate text-caption", quiet)}>
                    {users} users · {fx.devices.length} devices
                  </span>
                  <StatusPill onDark={selected}>{online} online</StatusPill>
                </span>
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}
