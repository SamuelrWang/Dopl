"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { formatShortDate } from "@/shared/lib/format-time";
import { EmptyState } from "@/shared/ui/empty-state";
import { NAKED_ICON_BUTTON } from "@/shared/ui/naked-icon-button";
import { SelectMenu, type SelectMenuOption } from "@/shared/ui/select-menu";
import { Skeleton } from "@/shared/ui/skeleton";
import { ThinMeter } from "@/shared/ui/usage-meter";
import { PERSONAL_MONTHLY_CREDITS } from "@/features/billing/credits";
import type { WorkspaceCreditsStatus } from "@/features/billing/components/use-workspace-entitlements";
import {
  EMPTY_SERIES,
  USAGE_SCOPE_ALL,
  USAGE_SCOPE_DESKTOP,
  type HomeOverviewSeries,
} from "@/features/home/overview-types";
import { monthKey, monthLabel, shiftMonthKey, utcDayLabel } from "@/features/home/overview-period";
import { pillButton } from "@/shared/ui/pill-button";
import { Bars, OverviewCard } from "./overview-card";
import type { HomeOverviewReads, OverviewRead } from "./use-home-overview-reads";
import styles from "./overview.module.css";

export interface HomeChannelOption {
  id: string;
  name: string;
}

/**
 * This period's allowance off the wallet counter, the figure enforcement charged. A `limit` of 0
 * (a payer that never resolved) falls back to the personal free allowance rather than printing a
 * zero denominator; `over` is the payer's verdict, never `used >= limit`.
 */
export function creditAllowance(credits: WorkspaceCreditsStatus) {
  const limit = credits.limit > 0 ? credits.limit : PERSONAL_MONTHLY_CREDITS.free;
  return {
    used: credits.used,
    limit,
    left: Math.max(0, limit - credits.used),
    over: credits.remaining === 0 && credits.limit > 0,
  };
}

/** The meter fill once the period is spent. */
export const OVER_METER = "var(--warning)";

/** All channels, Desktop agent, then each home channel by its own id (the left pane's read). */
function ScopeMenu({
  value,
  channels,
  onChange,
}: {
  value: string;
  channels: readonly HomeChannelOption[];
  onChange: (next: string) => void;
}) {
  const options: SelectMenuOption<string>[] = [
    { value: USAGE_SCOPE_ALL, label: "All channels" },
    {
      value: USAGE_SCOPE_DESKTOP,
      label: "Desktop agent",
      description: "Credits burned outside any channel.",
    },
    ...channels.map((channel) => ({ value: channel.id, label: channel.name })),
  ];
  return (
    <SelectMenu
      value={value}
      options={options}
      onChange={onChange}
      variant="outline"
      ariaLabel="Usage scope"
    />
  );
}

/** `‹ September 2026 ›`: next is disabled at the current month; there is no lower bound. */
function MonthStepper({
  month,
  onChange,
}: {
  month: string;
  onChange: (next: string) => void;
}) {
  const arrow = cn(NAKED_ICON_BUTTON, "p-1 disabled:opacity-35");
  return (
    <span className="inline-flex items-center gap-0.5">
      <button
        type="button"
        aria-label="Previous month"
        className={arrow}
        onClick={() => onChange(shiftMonthKey(month, -1))}
      >
        <ChevronLeft size={13} aria-hidden="true" />
      </button>
      <span className="whitespace-nowrap text-caption text-text-secondary">{monthLabel(month)}</span>
      <button
        type="button"
        aria-label="Next month"
        disabled={month >= monthKey()}
        className={arrow}
        onClick={() => onChange(shiftMonthKey(month, 1))}
      >
        <ChevronRight size={13} aria-hidden="true" />
      </button>
    </span>
  );
}

function Allowance({ credits }: { credits: WorkspaceCreditsStatus }) {
  const { used, limit, left, over } = creditAllowance(credits);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline gap-1.5">
        <span className={styles.figure}>{used.toLocaleString()}</span>
        <span className="text-text-muted">of {limit.toLocaleString()} used</span>
      </div>
      <ThinMeter used={used} limit={limit} color={over ? OVER_METER : null} />
      <div className={styles.metaLine}>
        <span>{left.toLocaleString()} left</span>
        {credits.periodEnd && <span>Resets {formatShortDate(credits.periodEnd)}</span>}
        {/* Counter vs ledger, subtracted by the server: one word, never the figure. */}
        {credits.ledgerDrift !== 0 && <span>Unreconciled</span>}
        {credits.unmeteredSince && <span>Unmetered</span>}
      </div>
      {over && (
        <p className={styles.note} data-tone="over">
          Tool calls are paused until the next period.
        </p>
      )}
    </div>
  );
}

/** The month's daily credits. The total is the plot's own bars, so a narrowed scope or a past
 *  month differs from the allowance above by design. */
function DailyCredits({
  series,
  month,
}: {
  series: OverviewRead<HomeOverviewSeries>;
  month: string;
}) {
  if (!series.data) {
    return series.error ? (
      <p className={styles.note}>Couldn&apos;t load daily credits.</p>
    ) : (
      <Skeleton className="h-16 w-full rounded-md" />
    );
  }
  const points = series.data.points ?? EMPTY_SERIES;
  if (points.length === 0) return <EmptyState variant="outline" title="No credits spent" />;
  return (
    <>
      <Bars
        bars={points.map((point) => ({
          key: point.at,
          value: point.count,
          label: `${utcDayLabel(point.at)} · ${point.count.toLocaleString()} credits`,
        }))}
        label={`Daily credits, ${monthLabel(month)}`}
        dim={series.isPlaceholderData}
      />
      {series.data.truncated && <p className={styles.note}>Newest rows only.</p>}
    </>
  );
}

export function CreditsCard({
  wallet,
  series,
  scope,
  month,
  channels,
  onScope,
  onMonth,
  onGetCredits,
}: {
  wallet: HomeOverviewReads["wallet"];
  series: OverviewRead<HomeOverviewSeries>;
  scope: string;
  month: string;
  channels: readonly HomeChannelOption[];
  onScope: (next: string) => void;
  onMonth: (next: string) => void;
  onGetCredits: () => void;
}) {
  const over = !wallet.loading && creditAllowance(wallet.credits).over;
  const total = (series.data?.points ?? EMPTY_SERIES).reduce((sum, point) => sum + point.count, 0);
  return (
    <OverviewCard
      title="Credits"
      className={styles.slotCredits}
      aside={
        !wallet.loading &&
        !wallet.isPaid && (
          <button
            type="button"
            className={over ? pillButton("ink", "sm") : pillButton("outline", "sm")}
            onClick={onGetCredits}
          >
            Get more credits
          </button>
        )
      }
    >
      {wallet.loading ? (
        <Skeleton className="h-13.5 w-full rounded-md" />
      ) : (
        <Allowance credits={wallet.credits} />
      )}
      <div className={styles.divider} />
      <div className="flex min-w-0 items-center gap-2">
        <ScopeMenu value={scope} channels={channels} onChange={onScope} />
        <MonthStepper month={month} onChange={onMonth} />
        {series.data && (
          <span className={cn(styles.mono, styles.total)}>
            {total.toLocaleString()}
          </span>
        )}
      </div>
      <DailyCredits series={series} month={month} />
    </OverviewCard>
  );
}
