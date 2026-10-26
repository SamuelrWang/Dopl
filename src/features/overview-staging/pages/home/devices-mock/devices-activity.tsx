// STAGING COPY of apps/desktop-ui/src/pages/home/devices-mock/devices-activity.tsx @ branch devices-dashboard-mock. Only import paths differ from the source
// (desktop `#/` modules → staging copies, data hooks → ./stubs). See src/features/overview-staging/PORTING.md.
import { useMemo, useState } from "react";
import { cn } from "@/shared/lib/utils";
import { RAISED_INPUT } from "@/shared/ui/wells";
import { IDENTITY_NAME_TEXT } from "@/shared/ui/section-heading";
import { SegmentedControl } from "@/shared/ui/segmented-control";
import { SelectMenu, type SelectMenuOption } from "@/shared/ui/select-menu";
import { DEVICES_MOCK, type LogLevel } from "@/features/overview-staging/overview-mock-data";
import { Figure, HopTrail, KindMark } from "./devices-bits";
import {
  DEV_MONO,
  DEV_PROSE,
  DEV_ROW,
  SMALL_BTN,
  deviceRef,
  type DeviceRef,
} from "./devices-ui";

/**
 * THE DEVICES SECTION'S ONE FEED.
 *
 * ⚠ It was two cards and they were the same card (4a): Routing's "Recent" list and Logs were both
 * a timestamped feed of device events, rendered two different ways. One card, two tabs.
 * ⚠ Every row is ONE LINE (4b): routing rows were three and log rows were two.
 *
 * ── 4c ───────────────────────────────────────────────────────────────────────────────────────
 * ⚠ **THE KIND IS AN ICON, NOT A CHIP.** Four categories read faster as four shapes than as four
 * same-shaped pills; a column of identical outlines is exactly the *"bunch of pills"* Samuel
 * rejected, and it was five of them down the left edge.
 * ⚠ **THE LANDING DEVICE LOST ITS FILLED PILL** (`./devices-bits.tsx › HopTrail`): five black
 * pills down the right edge were competing with the one claim on the page that should be filled.
 * ⚠ **THE SENDER AND THE LOG'S DEVICE ARE MUTED TYPE**, because they are qualifiers on the line
 * beside them, not facts of their own.
 * ⚠ **THE HEADER CARRIES A FIGURE**, so the row between the title and the tabs is not blank.
 *
 * ⚠ Full width is correct here and it is not a contradiction of the bento: a feed's columns
 * (clock, mark, line, qualifier, trail) are horizontal, every one of them is filled, and one-line
 * rows keep the card short.
 */

type Tab = "routing" | "logs";

const TABS = [
  { key: "routing" as const, label: "Routing" },
  { key: "logs" as const, label: "Logs" },
];

export function ActivityBlock({
  devices,
  direct,
  className,
}: {
  devices: Map<string, DeviceRef>;
  /** Routes that landed on the FIRST device tried — the quality figure for this card's header. */
  direct: number;
  className?: string;
}) {
  const [tab, setTab] = useState<Tab>("routing");

  return (
    // 4d: NO CARD. A header row closed by a hairline, then the feed — the same shape the section
    // header itself uses, one level down.
    <section className={cn("flex flex-col px-1", className)} aria-label="Activity">
      <div className="flex items-center gap-4 border-t border-border-subtle pt-3">
        <h3 className={cn("shrink-0", IDENTITY_NAME_TEXT)}>Activity</h3>
        {/* ⚠ RULE 1: the figure is NOT `flex-1`. Stretching it made its box 600px wide with the
            number pinned to the left of it — the "blank majority" case. Title and figure cluster
            on the left, the tab strip takes the right edge, and the row is content on both ends
            rather than one side and air (Rule 1 §3, leading/trailing with purpose). */}
        <Figure value={`${direct}/${DEVICES_MOCK.routes.length}`} unit="answered first try" />
        {/* `underline` — the face the frame's own page tabs wear, so a tab row reads as a tab row
            wherever it sits (staging.css › "TOP TABS"). */}
        <SegmentedControl
          options={TABS}
          value={tab}
          onChange={setTab}
          variant="underline"
          ariaLabel="Activity view"
          className="ml-auto"
        />
      </div>

      {tab === "routing" ? <RoutingFeed devices={devices} /> : <LogsFeed devices={devices} />}
    </section>
  );
}

/* --------------------------------- routing --------------------------------- */

/**
 * WHERE EACH MESSAGE WENT. Five columns, five different kinds of element, all of them filled:
 * the clock (mono), the kind (an icon), what was said (the row's one body face), who asked it
 * (muted, a qualifier), and the hops it took to land (a trail).
 */
function RoutingFeed({ devices }: { devices: Map<string, DeviceRef> }) {
  return (
    <ul className="mt-2 flex flex-col divide-y divide-border-subtle border-t border-border-subtle">
      {DEVICES_MOCK.routes.map((route) => (
        <li key={route.id} className="flex items-center gap-2.5 py-2">
          <span className={cn("w-9 shrink-0", DEV_MONO)}>{route.at}</span>
          <KindMark kind={route.kind} />
          <span className={cn("min-w-0 flex-1 truncate", DEV_ROW)}>{route.summary}</span>
          <span className={cn("min-w-0 shrink truncate", DEV_PROSE)}>{route.from}</span>
          <HopTrail tried={route.tried} devices={devices} />
        </li>
      ))}
    </ul>
  );
}

/* ---------------------------------- logs ---------------------------------- */

const LEVEL_DOT: Record<LogLevel, string> = {
  info: "bg-text-disabled",
  warn: "bg-warning",
  error: "bg-danger",
};
const LEVELS = [
  { key: "all" as const, label: "All" },
  { key: "info" as const, label: "Info" },
  { key: "warn" as const, label: "Warnings" },
  { key: "error" as const, label: "Errors" },
];

/**
 * WHAT EACH DEVICE LOGGED. One line: severity dot, clock, event, detail, device.
 *
 * ⚠ The grey well and the 5-column all-11.5px grid are gone (4a); the second line went with it
 * (4b); the device chip became muted type (4c).
 * ⚠ The controls are the KIT's: `SelectMenu` for the device (was a native `<select>`),
 * `SegmentedControl` for the level (was a hand-rolled track imitating `.concave-track`),
 * The kit's `RAISED_INPUT` for the search (was a bare bordered input, then briefly concave).
 */
function LogsFeed({ devices }: { devices: Map<string, DeviceRef> }) {
  const [device, setDevice] = useState<string>("all");
  const [level, setLevel] = useState<LogLevel | "all">("all");
  const [query, setQuery] = useState("");

  const deviceOptions = useMemo<SelectMenuOption<string>[]>(() => {
    const ids = Array.from(new Set(DEVICES_MOCK.logs.map((log) => log.deviceId)));
    return [
      { value: "all", label: "All devices" },
      ...ids.map((id) => ({ value: id, label: deviceRef(devices, id).name })),
    ];
  }, [devices]);

  const q = query.trim().toLowerCase();
  const rows = DEVICES_MOCK.logs.filter(
    (log) =>
      (device === "all" || log.deviceId === device) &&
      (level === "all" || log.level === level) &&
      (!q || `${log.event} ${log.detail}`.toLowerCase().includes(q))
  );

  return (
    <>
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <SelectMenu
          value={device}
          options={deviceOptions}
          onChange={setDevice}
          ariaLabel="Device"
          variant="flat"
        />
        <SegmentedControl
          options={LEVELS}
          value={level}
          onChange={setLevel}
          ariaLabel="Severity"
        />
        <input
          aria-label="Search logs"
          placeholder="Search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          // `RAISED_INPUT`, not `.concave-field` — see `devices-overview.tsx` (4d): concave is
          // banned on /home by the surface sweep.
          // ⚠ RULE 1: a fixed 13rem, not `flex-1`. A search box stretched to the pane is a
          // 700px field holding a 12-character placeholder.
          className={cn(RAISED_INPUT, "h-8 w-52 px-2.5 text-caption")}
        />
      </div>

      {rows.length === 0 ? (
        <p className={cn("mt-3 border-t border-border-subtle pt-3", DEV_PROSE)}>
          No matching entries.
        </p>
      ) : (
        <ul className="mt-2 flex flex-col divide-y divide-border-subtle border-t border-border-subtle">
          {rows.map((log) => (
            <li key={log.id} className="flex items-center gap-2.5 py-1.5">
              <span
                className={cn("h-1.5 w-1.5 shrink-0 rounded-full", LEVEL_DOT[log.level])}
                title={log.level}
              />
              <span className={cn("w-9 shrink-0", DEV_MONO)}>{log.at.slice(0, 5)}</span>
              <span className={cn("shrink-0 truncate", DEV_ROW)}>{log.event}</span>
              <span className={cn("min-w-0 flex-1 truncate", DEV_PROSE)}>{log.detail}</span>
              <span className={cn("shrink-0 truncate text-label text-text-muted", "max-w-[9rem]")}>
                {deviceRef(devices, log.deviceId).name}
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-2 flex justify-end">
        <button type="button" disabled className={cn(SMALL_BTN, "cursor-not-allowed opacity-60")}>
          Copy diagnostics (preview)
        </button>
      </div>
    </>
  );
}
