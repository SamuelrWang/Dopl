"use client";

/** Charts and limits, on the gallery's bar recipe. */
import { useState } from "react";
import { cx } from "./components";
import c from "./output.module.css";
import d from "./data.module.css";
import { Meter } from "./ui";
import { Text } from "./ui-page";

interface Bar {
  key: string;
  value: number;
  label: string;
  tick: string;
}

/** One bar per point. Hover names a bar; otherwise the latest is named. */
export function BarChart({ bars, ticks = 6 }: { bars: Bar[]; ticks?: number }) {
  const [hover, setHover] = useState<string | null>(null);
  const top = Math.max(...bars.map((b) => b.value), 1);
  const named = bars.find((b) => b.key === hover) ?? bars[bars.length - 1];
  // Evenly spaced and always ending on the latest bar, the one named above.
  const count = Math.min(ticks, bars.length);
  const shown = Array.from({ length: count }, (_, i) => bars[Math.round((i * (bars.length - 1)) / Math.max(count - 1, 1))]);
  return (
    <div className={c.chart}>
      <Text kind="muted">{named?.label}</Text>
      <div className={cx(d.bars, c.chartBars)} role="img" aria-label={`${bars.length} days of deliveries`} onMouseLeave={() => setHover(null)}>
        {bars.map((b) => (
          <div key={b.key} className={d.barCol} onMouseEnter={() => setHover(b.key)}>
            <div className={cx(d.barRect, b === named && d.barRectOn)} style={{ height: `${Math.max(2, (b.value / top) * 100)}%` }} />
          </div>
        ))}
      </div>
      <div className={c.chartTicks} aria-hidden="true">
        {shown.map((b) => (
          <Text key={b.key} kind="smallMuted" nowrap>
            {b.tick}
          </Text>
        ))}
      </div>
    </div>
  );
}

/** A plan limit: name, used of limit, its meter. Red when nearly full. */
export function Limit({ label, used, limit, goal, format = String }: { label: string; used: number; limit: number; /** Full is the aim, as with tests passed, so it never turns red. */ goal?: boolean; format?: (n: number) => string }) {
  const share = Math.min(100, Math.round((used / limit) * 100));
  return (
    <div className={c.limit}>
      <span className={c.limitHead}>
        <Text>{label}</Text>
        <Text kind="smallMuted" num nowrap>
          {format(used)} of {format(limit)}
        </Text>
      </span>
      <Meter value={share} tone={!goal && share >= 90 ? "error" : "ink"} />
    </div>
  );
}

export interface Step {
  key: string;
  label: string;
  detail?: string;
  /** Right-aligned, such as a duration. */
  at?: string;
  state: "done" | "failed" | "pending";
}

/** Steps in order, on the gallery's timeline recipe. */
export function Timeline({ steps }: { steps: Step[] }) {
  return (
    <ol className={d.timeline}>
      {steps.map((s, i) => (
        <li key={s.key} className={d.tItem}>
          <span className={d.tRail}>
            <span className={cx(d.tDot, s.state === "done" && d.tDotOn, s.state === "failed" && c.dotFail, s.state === "pending" && c.dotFaint)} />
            {i < steps.length - 1 && <span className={d.tLine} />}
          </span>
          <span className={c.stepBody}>
            <span className={c.limitHead}>
              <Text kind={s.state === "pending" ? "faint" : "strong"}>{s.label}</Text>
              {s.at && (
                <Text kind="smallMuted" num nowrap>
                  {s.at}
                </Text>
              )}
            </span>
            {s.detail && <Text kind="smallMuted">{s.detail}</Text>}
          </span>
        </li>
      ))}
    </ol>
  );
}

/** A trend as one line, on a fixed range when given so small moves stay small. */
export function LineChart({ values, label, min, max }: { values: number[]; label: string; min?: number; max?: number }) {
  const low = min ?? Math.min(...values);
  const high = max ?? Math.max(...values);
  const span = Math.max(high - low, 1);
  const points = values.map((v, i) => [(i / Math.max(values.length - 1, 1)) * 100, 92 - ((v - low) / span) * 84] as const);
  const path = points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`).join(" ");
  return (
    <svg className={c.line} viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label={label} fill="none">
      {[8, 36, 64, 92].map((y) => (
        <path key={y} d={`M0 ${y}H100`} stroke="#ececec" strokeWidth={1} vectorEffect="non-scaling-stroke" />
      ))}
      <path d={path} stroke="#000" strokeWidth={1.8} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** Progress as a ring, with its figure inside. */
export function Ring({ value, label }: { value: number; label: string }) {
  const r = 34;
  const around = 2 * Math.PI * r;
  return (
    <svg className={c.ring} viewBox="0 0 87.5 87.5" fill="none" role="img" aria-label={label}>
      <circle cx={43.75} cy={43.75} r={r} stroke="#d9d9d9" strokeWidth={8.75} />
      <circle cx={43.75} cy={43.75} r={r} stroke="#000" strokeWidth={8.75} strokeLinecap="round" strokeDasharray={`${(value / 100) * around} ${around}`} transform="rotate(-90 43.75 43.75)" />
      <text x={43.75} y={49.5} textAnchor="middle" fontSize={17.5} fontWeight={600} letterSpacing="-0.03em" fill="#000">
        {value}%
      </text>
    </svg>
  );
}
