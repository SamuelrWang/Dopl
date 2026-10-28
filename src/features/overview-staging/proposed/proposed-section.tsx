import type { ReactNode } from "react";
import { cn } from "@/shared/lib/utils";
import { formatTokens } from "@/shared/lib/format-tokens";
import { IDENTITY_NAME_TEXT } from "@/shared/ui/section-heading";
import styles from "./proposed.module.css";

/**
 * One section of a panel: the title row (count beside it, `aside` at its right end) over the body.
 * Replaces the product's `OverviewCard`: no card of its own, a hairline above it instead.
 */
export function Section({
  title,
  count,
  attention = false,
  aside,
  className,
  children,
}: {
  title: string;
  count?: ReactNode;
  /** The count is something waiting on the reader. */
  attention?: boolean;
  aside?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={cn(styles.section, className)} aria-label={title}>
      <header className={styles.head}>
        <h3 className={IDENTITY_NAME_TEXT}>{title}</h3>
        {count !== undefined && (
          <span className={styles.count} data-tone={attention ? "attention" : undefined}>
            {count}
          </span>
        )}
        {aside && <span className={styles.aside}>{aside}</span>}
      </header>
      <div className={styles.body}>{children}</div>
    </section>
  );
}

/** `184` → `"3h 4m"`. */
export const runTime = (minutes: number) =>
  minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;

/** `formatTokens` with a billions arm: `4_876_300_000` → `"4.8B"`. Floors, as `formatTokens` does,
 *  because the underlying figure is already a floor. */
export function humanTokens(tokens: number): string {
  if (tokens >= 1_000_000_000) return `${Math.floor(tokens / 100_000_000) / 10}B`;
  return formatTokens(tokens);
}
