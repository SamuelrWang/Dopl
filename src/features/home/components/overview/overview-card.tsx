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
}

/** A bar strip scaled to its tallest bar; a measured zero still draws a tick. */
export function Bars({ bars, label, dim = false }: { bars: readonly Bar[]; label: string; dim?: boolean }) {
  const peak = Math.max(1, ...bars.map((bar) => bar.value));
  return (
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
  );
}
