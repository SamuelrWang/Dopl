"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { formatShortDate } from "@/shared/lib/format-time";
import { EmptyState } from "@/shared/ui/empty-state";
import { NAKED_ICON_BUTTON } from "@/shared/ui/naked-icon-button";
import { SegmentedControl } from "@/shared/ui/segmented-control";
import { SelectMenu, type SelectMenuOption } from "@/shared/ui/select-menu";
import { Skeleton } from "@/shared/ui/skeleton";
import { ThinMeter } from "@/shared/ui/usage-meter";
import { pillButton } from "@/shared/ui/pill-button";
import { bucketByLocalDay, localDayKey, localDayLabel, type TokenSpendReport } from "@/shared/lib/token-spend-days";
import type { WorkspaceCreditsStatus } from "@/features/billing/components/use-workspace-entitlements";
import {
  EMPTY_SERIES,
  USAGE_SCOPE_ALL,
  USAGE_SCOPE_DESKTOP,
  type HomeOverviewSeries,
} from "@/features/home/overview-types";
import { monthKey, monthLabel, shiftMonthKey, utcDayLabel } from "@/features/home/overview-period";
import { Bars } from "@/features/home/components/overview/overview-card";
import {
  OVER_METER,
  creditAllowance,
  type HomeChannelOption,
} from "@/features/home/components/overview/overview-credits";
import type { HomeOverviewReads, OverviewRead } from "@/features/home/components/overview/use-home-overview-reads";
import { Section, humanTokens } from "./proposed-section";
import styles from "./proposed.module.css";

type UsageTab = "credits" | "tokens";

const NO_MARKS: TokenSpendReport["marks"] = [];

/** All channels, Desktop agent, then each home channel by its own id. */
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
    { value: USAGE_SCOPE_DESKTOP, label: "Desktop agent" },
    ...channels.map((channel) => ({ value: channel.id, label: channel.name })),
  ];
  return <SelectMenu value={value} options={options} onChange={onChange} variant="outline" ariaLabel="Usage scope" />;
}

/** `‹ October 2026 ›`: next is disabled at the current month. Shared by both tabs. */
function MonthStepper({ month, onChange }: { month: string; onChange: (next: string) => void }) {
  const arrow = cn(NAKED_ICON_BUTTON, "p-1 disabled:opacity-35");
  return (
    <span className="inline-flex items-center gap-0.5">
      <button type="button" aria-label="Previous month" className={arrow} onClick={() => onChange(shiftMonthKey(month, -1))}>
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

/** One framing: what is left of the allowance, its meter, when it resets. */
function Allowance({ credits }: { credits: WorkspaceCreditsStatus }) {
  const { used, limit, left, over } = creditAllowance(credits);
  return (
    <div className="flex flex-col gap-2">
      <div className={styles.lead}>
        <span className={styles.figure}>{left.toLocaleString()}</span>
        <span className="text-text-muted">left of {limit.toLocaleString()}</span>
      </div>
      <ThinMeter used={used} limit={limit} color={over ? OVER_METER : null} />
      <div className={styles.metaLine}>
        {credits.periodEnd && <span>Resets {formatShortDate(credits.periodEnd)}</span>}
        {credits.ledgerDrift !== 0 && <span>Unreconciled</span>}
        {credits.unmeteredSince && <span>Unmetered</span>}
      </div>
      {over && (
        <p className={styles.note} data-tone="attention">
          Tool calls are paused until the next period.
        </p>
      )}
    </div>
  );
}

/** The month's local day keys, oldest first, for the token bars to share the credit bars' axis. */
function monthDays(month: string): string[] {
  const [year = 2026, mon = 1] = month.split("-").map(Number);
  const count = new Date(year, mon, 0).getDate();
  return Array.from({ length: count }, (_, i) => localDayKey(new Date(year, mon - 1, i + 1)));
}

function CreditBars({ series, month }: { series: OverviewRead<HomeOverviewSeries>; month: string }) {
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
    <Bars
      bars={points.map((point) => {
        const tick = utcDayLabel(point.at);
        return { key: point.at, value: point.count, label: `${tick} · ${point.count.toLocaleString()} credits`, tick };
      })}
      label={`Daily credits, ${monthLabel(month)}`}
      dim={series.isPlaceholderData}
    />
  );
}

function TokenBars({ spend, month }: { spend: OverviewRead<TokenSpendReport>; month: string }) {
  if (!spend.data) {
    return spend.error ? (
      <p className={styles.note}>Couldn&apos;t load token spend.</p>
    ) : (
      <Skeleton className="h-16 w-full rounded-md" />
    );
  }
  const days = monthDays(month);
  const { byDay, runs } = bucketByLocalDay(spend.data.marks ?? NO_MARKS, days);
  if (runs === 0) return <EmptyState variant="outline" title="No tokens spent" />;
  return (
    <Bars
      bars={days.map((day) => {
        const tokens = byDay.get(day) ?? 0;
        const tick = localDayLabel(day);
        return { key: day, value: tokens, label: `${tick} · ${humanTokens(tokens)} tokens`, tick };
      })}
      label={`Daily tokens, ${monthLabel(month)}`}
    />
  );
}

/**
 * Credits and tokens in one section. The allowance leads; one control row (tab, scope, month) and
 * one bar strip serve both tabs. The credit total is the month's ledger sum for the scope (the bars'
 * own total), so it is labelled with its month, never set beside the allowance as a "used" figure.
 */
export function UsageSection({
  wallet,
  series,
  spend,
  scope,
  month,
  channels,
  onScope,
  onMonth,
  onGetCredits,
}: Pick<HomeOverviewReads, "wallet" | "series" | "spend"> & {
  scope: string;
  month: string;
  channels: readonly HomeChannelOption[];
  onScope: (next: string) => void;
  onMonth: (next: string) => void;
  onGetCredits: () => void;
}) {
  const [tab, setTab] = useState<UsageTab>("credits");
  const over = !wallet.loading && creditAllowance(wallet.credits).over;
  const short = monthLabel(month).split(" ")[0]?.slice(0, 3);
  const creditTotal = (series.data?.points ?? EMPTY_SERIES).reduce((sum, point) => sum + point.count, 0);
  const tokenTotal = spend.data ? bucketByLocalDay(spend.data.marks ?? NO_MARKS, monthDays(month)).total : 0;
  const total =
    tab === "credits"
      ? series.data && `${creditTotal.toLocaleString()} in ${short}`
      : spend.data && tokenTotal > 0 && `${humanTokens(tokenTotal)} tokens`;
  return (
    <Section
      title="Usage"
      aside={
        !wallet.loading &&
        !wallet.isPaid && (
          <button type="button" className={over ? pillButton("ink", "sm") : pillButton("outline", "sm")} onClick={onGetCredits}>
            Get more credits
          </button>
        )
      }
    >
      {wallet.loading ? <Skeleton className="h-13.5 w-full rounded-md" /> : <Allowance credits={wallet.credits} />}
      <div className={styles.controls}>
        <SegmentedControl
          options={[
            { key: "credits", label: "Credits" },
            { key: "tokens", label: "Tokens" },
          ]}
          value={tab}
          onChange={setTab}
          variant="underline"
          size="sm"
          ariaLabel="Usage metric"
        />
        {tab === "credits" && <ScopeMenu value={scope} channels={channels} onChange={onScope} />}
        <MonthStepper month={month} onChange={onMonth} />
        {total && <span className={styles.total}>{total}</span>}
      </div>
      {tab === "credits" ? <CreditBars series={series} month={month} /> : <TokenBars spend={spend} month={month} />}
    </Section>
  );
}
