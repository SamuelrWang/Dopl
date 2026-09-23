import { IDENTITY_NAME_TEXT } from "@/features/agent-identities/components/identity-section";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { SelectMenu, type SelectMenuOption } from "@/shared/ui/select-menu";
import { NAKED_ICON_BUTTON } from "@/shared/ui/naked-icon-button";
import { cn } from "@/shared/lib/utils";
import {
  USAGE_SCOPE_ALL,
  USAGE_SCOPE_DESKTOP,
} from "@/features/home/overview-types";
import { useHomeChannels } from "./use-home-channels";

/**
 * The /home usage histogram's two controls: the scope menu and the month stepper. Neither touches
 * the capacity bar, which is the wallet's current period. Session state only; nothing persisted.
 */

/* ------------------------------ the scope ------------------------------ */

export { USAGE_SCOPE_ALL, USAGE_SCOPE_DESKTOP };

/**
 * All channels, then each home channel (the left pane's own read and filter — a cache hit), then
 * Desktop agent (MCP traffic with no calling channel: `channel_id IS NULL`). A channel option's
 * value is the channel's OWN id, not its container (`overview-series-params.ts ›
 * resolveUsageChannel`).
 */
export function UsageScopeMenu({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  const rows = useHomeChannels();
  const options: SelectMenuOption<string>[] = [
    { value: USAGE_SCOPE_ALL, label: "All channels" },
    ...rows.map((channel) => ({
      value: channel.id,
      label: channel.name,
    })),
    {
      value: USAGE_SCOPE_DESKTOP,
      label: "Desktop agent",
      // The one option whose name does not say what it holds (INVARIANTS §5: a rule, not an explainer).
      description: "Credits burned outside any channel.",
    },
  ];
  return (
    <SelectMenu
      value={value}
      options={options}
      onChange={onChange}
      variant="text"
      ariaLabel="Usage scope"
      // The 14px face, not the Usage heading's larger one (Samuel rejected the larger size).
      className={IDENTITY_NAME_TEXT}
    />
  );
}

/* ------------------------------ the month ------------------------------ */

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** `YYYY-MM` of `at` in UTC — the calendar the server bins by (`service-overview.ts ›
 *  rangeWindows`). */
export function monthKey(at: Date = new Date()): string {
  return `${at.getUTCFullYear()}-${String(at.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** `YYYY-MM` ± n months, carrying the year. */
export function shiftMonthKey(key: string, delta: number): string {
  const [year = "", month = ""] = key.split("-");
  return monthKey(new Date(Date.UTC(Number(year), Number(month) - 1 + delta, 1)));
}

/** `"2026-09"` → `"September 2026"`. */
export function monthLabel(key: string): string {
  const [year = "", month = ""] = key.split("-");
  return `${MONTH_NAMES[Number(month) - 1] ?? month} ${year}`;
}

/** One notch above `NAKED_ICON` to match the 14px label beside it; the face stays
 *  `NAKED_ICON_BUTTON`, so the `p-2` hit area only grows. */
const MONTH_ARROW_ICON = 16;

/** `‹ September 2026 ›`. `›` is disabled (not hidden) at the current month; no lower bound — an
 *  older month reads as a flat axis. */
export function MonthStepper({
  month,
  onChange,
  className,
}: {
  month: string;
  onChange: (next: string) => void;
  className?: string;
}) {
  const atCurrent = month >= monthKey();
  return (
    <div className={cn("flex items-center gap-0.5", className)}>
      <button
        type="button"
        aria-label="Previous month"
        className={NAKED_ICON_BUTTON}
        onClick={() => onChange(shiftMonthKey(month, -1))}
      >
        <ChevronLeft size={MONTH_ARROW_ICON} aria-hidden="true" />
      </button>
      {/* The scope menu's 14px face, not the Usage heading's. */}
      <span className={cn("min-w-0 truncate", IDENTITY_NAME_TEXT)}>
        {monthLabel(month)}
      </span>
      <button
        type="button"
        aria-label="Next month"
        disabled={atCurrent}
        className={cn(NAKED_ICON_BUTTON, "disabled:opacity-40")}
        onClick={() => onChange(shiftMonthKey(month, 1))}
      >
        <ChevronRight size={MONTH_ARROW_ICON} aria-hidden="true" />
      </button>
    </div>
  );
}

/* ------------------------------- the path ------------------------------- */

/** The histogram's read. A default selection sends neither param, so the first read shares the
 *  face's one cache entry. */
export function usageSeriesPath({
  range,
  metric,
  scope,
  month,
}: {
  range: string;
  metric: string;
  scope: string;
  month: string;
}): string {
  const params = [`range=${range}`, `metric=${metric}`];
  if (scope !== USAGE_SCOPE_ALL) params.push(`channel=${scope}`);
  if (month !== monthKey()) params.push(`month=${month}`);
  return `/api/home/overview-series?${params.join("&")}`;
}
