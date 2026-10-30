"use client";

/** Charts and limits, on the gallery's bar recipe. */
import { useState } from "react";
import { cx } from "./components";
import c from "./output.module.css";
import d from "./data.module.css";
import { Meter } from "./ui";
import { Text } from "./ui-page";

export interface Bar {
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
function LimitRow({ label, used, limit }: { label: string; used: string; limit: string }) {
  return (
    <span className={c.limitHead}>
      <Text>{label}</Text>
      <Text kind="smallMuted" num nowrap>
        {used} of {limit}
      </Text>
    </span>
  );
}

export function Limit({ label, used, limit, goal, format = String }: { label: string; used: number; limit: number; /** Full is the aim, as with tests passed, so it never turns red. */ goal?: boolean; format?: (n: number) => string }) {
  const share = Math.min(100, Math.round((used / limit) * 100));
  return (
    <div className={c.limit}>
      <LimitRow label={label} used={format(used)} limit={format(limit)} />
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
