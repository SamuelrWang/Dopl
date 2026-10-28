import type { ReactNode } from "react";
import { cn } from "@/shared/lib/utils";
import { IDENTITY_NAME_TEXT } from "@/shared/ui/section-heading";
import styles from "./overview.module.css";

/** One white card: the title row (count beside it, `aside` at its right end) over the body. */
export function OverviewCard({
  title,
  count,
  aside,
  className,
  children,
}: {
  title: string;
  count?: ReactNode;
  aside?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={cn("white-card", styles.card, className)} aria-label={title}>
      <header className={styles.head}>
        <h3 className={IDENTITY_NAME_TEXT}>{title}</h3>
        {count !== undefined && <span className={styles.count}>{count}</span>}
        {aside && <span className={styles.aside}>{aside}</span>}
      </header>
      <div className={styles.body}>{children}</div>
    </section>
  );
}

export interface Bar {
  key: string;
  value: number;
  /** "Sep 3 · 120 credits": the bar's hover title and its accessible name. */
  label: string;
  /** "Sep 3": what the date axis prints under the bar when it is one of the thinned ticks. */
  tick: string;
}

const AXIS_TICKS = 6;

/** Evenly spaced bar indexes, first and last always included. */
function tickIndexes(count: number): number[] {
  if (count <= AXIS_TICKS) return Array.from({ length: count }, (_, i) => i);
  return Array.from({ length: AXIS_TICKS }, (_, i) => Math.round((i * (count - 1)) / (AXIS_TICKS - 1)));
}

/** A bar strip scaled to its tallest bar over a thinned date axis; a measured zero still draws a tick. */
export function Bars({ bars, label, dim = false }: { bars: readonly Bar[]; label: string; dim?: boolean }) {
  const peak = Math.max(1, ...bars.map((bar) => bar.value));
  const last = bars.length - 1;
  return (
    <div className={styles.plot}>
      <span className={styles.bars} role="list" aria-label={label} data-dim={dim || undefined}>
        {bars.map((bar) => (
          <i
            key={bar.key}
            role="listitem"
            aria-label={bar.label}
            title={bar.label}
            data-zero={bar.value === 0 || undefined}
            style={{ height: `${Math.max(bar.value > 0 ? 6 : 2, (bar.value / peak) * 100)}%` }}
          />
        ))}
      </span>
      <span className={styles.axis} aria-hidden>
        {tickIndexes(bars.length).map((index) => {
          const edge = index === 0 ? "start" : index === last ? "end" : undefined;
          return (
            <span
              key={bars[index].key}
              data-edge={edge}
              style={edge ? undefined : { left: `${((index + 0.5) / bars.length) * 100}%` }}
            >
              {bars[index].tick}
            </span>
          );
        })}
      </span>
    </div>
  );
}
