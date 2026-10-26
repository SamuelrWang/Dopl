// STAGING ONLY. Overview credits (allowance + daily credits by scope and month) and tokens (31 days).
"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { formatShortDate } from "@/shared/lib/format-time";
import type { WorkspaceCreditsStatus } from "@/features/billing/components/use-workspace-entitlements";
import type { HomeSeriesPoint } from "@/features/home/overview-types";
import { ECard, EBars, EEmpty, EMeter } from "./overview-bits";
import { SCOPES, compact, monthKeyOf, monthName, shiftMonth, tokenDays } from "./overview-data";

/** A small scope picker: the label is the button, the list drops below. */
function ScopePicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  const label = SCOPES.find((s) => s.id === value)?.label ?? "All channels";
  return (
    <span className="ove-picker" ref={box}>
      <button
        type="button"
        className="ove-picker-btn"
        aria-label="Usage scope"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {label}
        <ChevronDown size={12} aria-hidden="true" />
      </button>
      {open && (
        <ul className="ove-picker-list" role="listbox" aria-label="Usage scope">
          {SCOPES.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                role="option"
                aria-selected={s.id === value}
                className="ove-picker-option"
                onClick={() => {
                  onChange(s.id);
                  setOpen(false);
                }}
              >
                {s.label}
                {s.id === value && <Check size={12} aria-hidden="true" />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </span>
  );
}

function MonthControl({ month, onChange }: { month: string; onChange: (m: string) => void }) {
  const current = month === monthKeyOf();
  return (
    <span className="ove-month">
      <button type="button" className="ove-icon-btn" aria-label="Previous month" onClick={() => onChange(shiftMonth(month, -1))}>
        <ChevronLeft size={13} aria-hidden="true" />
      </button>
      <span className="ove-month-name">{monthName(month)}</span>
      <button
        type="button"
        className="ove-icon-btn"
        aria-label="Next month"
        disabled={current}
        onClick={() => onChange(shiftMonth(month, 1))}
      >
        <ChevronRight size={13} aria-hidden="true" />
      </button>
    </span>
  );
}

export function CreditsCard({
  credits,
  isPaid,
  points,
  truncated,
  loadingPoints,
  scope,
  month,
  onScope,
  onMonth,
  onGetCredits,
}: {
  credits: WorkspaceCreditsStatus | null;
  isPaid: boolean;
  points: readonly HomeSeriesPoint[] | null;
  truncated: boolean;
  loadingPoints: boolean;
  scope: string;
  month: string;
  onScope: (id: string) => void;
  onMonth: (m: string) => void;
  onGetCredits: () => void;
}) {
  const limit = credits ? credits.limit : 0;
  const used = credits?.used ?? 0;
  const over = Boolean(credits && credits.remaining === 0 && credits.limit > 0);
  const total = (points ?? []).reduce((n, p) => n + p.count, 0);
  return (
    <ECard
      title="Credits"
      aside={!isPaid && credits ? (
        <button type="button" className="ove-btn" data-primary={over ? "true" : undefined} onClick={onGetCredits}>
          Get more credits
        </button>
      ) : undefined}
    >
      {credits ? (
        <div className="ove-allowance">
          <div className="ove-allowance-figure">
            <span className="ove-figure">{used.toLocaleString()}</span>
            <span className="ove-muted">of {limit.toLocaleString()} used</span>
          </div>
          <EMeter value={used} max={limit} tone={over ? "over" : undefined} />
          <div className="ove-meta-line">
            <span>{Math.max(0, limit - used).toLocaleString()} left</span>
            {credits.periodEnd && <span>Resets {formatShortDate(credits.periodEnd)}</span>}
            {credits.ledgerDrift !== 0 && <span>Unreconciled</span>}
            {credits.unmeteredSince && <span>Unmetered</span>}
          </div>
          {over && <p className="ove-note" data-tone="over">Tool calls are paused until the next period.</p>}
        </div>
      ) : (
        <span className="ove-skel" data-h="54" aria-hidden="true" />
      )}
      <div className="ove-divider" />
      <div className="ove-chart-head">
        <ScopePicker value={scope} onChange={onScope} />
        <MonthControl month={month} onChange={onMonth} />
        <span className="ove-mono ove-chart-total">{total.toLocaleString()}</span>
      </div>
      {points === null ? (
        <span className="ove-skel" data-h="72" aria-hidden="true" />
      ) : points.length === 0 ? (
        <EEmpty>No credits spent</EEmpty>
      ) : (
        <EBars values={points.map((p) => p.count)} label={`Daily credits, ${monthName(month)}`} dim={loadingPoints} />
      )}
      {truncated && <p className="ove-note">Newest rows only.</p>}
    </ECard>
  );
}

export function TokensCard({ marks }: { marks: ReadonlyArray<{ at: string; tokens: number }> | null }) {
  const days = marks ? tokenDays(marks) : null;
  return (
    <ECard title="Tokens" aside={<span className="ove-muted">31 days</span>}>
      {!days ? (
        <span className="ove-skel" data-h="72" aria-hidden="true" />
      ) : days.runs === 0 ? (
        <EEmpty>No agent has spent tokens</EEmpty>
      ) : (
        <>
          <div className="ove-allowance-figure">
            <span className="ove-figure">At least {compact(days.total)}</span>
            <span className="ove-muted">
              {days.runs} {days.runs === 1 ? "session" : "sessions"}
            </span>
          </div>
          <EBars values={days.values} label="Tokens per day, last 31 days" />
        </>
      )}
    </ECard>
  );
}
