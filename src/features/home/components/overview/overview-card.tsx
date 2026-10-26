import type { ReactNode } from "react";
import { cn } from "@/shared/lib/utils";
import { SECTION_TITLE } from "@/shared/ui/section-title";
import { INK_PILL, PILL_BUTTON } from "@/shared/ui/small-action-button";
import styles from "./overview.module.css";

/** The card's actions at the 26px card scale: the outlined pill and its ink twin. */
export const CARD_PILL = cn(PILL_BUTTON, "h-6.5 cursor-pointer gap-1 px-2.75");
export const CARD_INK_PILL = cn(INK_PILL, "gap-1");

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
        <h3 className={SECTION_TITLE}>{title}</h3>
        {count !== undefined && <span className={styles.count}>{count}</span>}
        {aside && <span className={styles.aside}>{aside}</span>}
      </header>
      <div className={styles.body}>{children}</div>
    </section>
  );
}

/** A bar strip scaled to its tallest bar; a measured zero still draws a tick. */
export function Bars({
  values,
  label,
  dim = false,
}: {
  values: readonly number[];
  label: string;
  dim?: boolean;
}) {
  const peak = Math.max(1, ...values);
  return (
    <span className={styles.bars} role="img" aria-label={label} data-dim={dim || undefined}>
      {values.map((value, i) => (
        <i
          key={i}
          data-zero={value === 0 || undefined}
          style={{ height: `${Math.max(value > 0 ? 6 : 2, (value / peak) * 100)}%` }}
        />
      ))}
    </span>
  );
}
