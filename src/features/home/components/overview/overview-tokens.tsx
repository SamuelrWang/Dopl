import { formatTokens } from "@/shared/lib/format-tokens";
import { EmptyState } from "@/shared/ui/empty-state";
import { Skeleton } from "@/shared/ui/skeleton";
import {
  TOKEN_SPEND_WINDOW_DAYS,
  bucketByLocalDay,
  localDayLabel,
  windowDays,
  type TokenSpendReport,
} from "@/shared/lib/token-spend-days";
import { Bars, OverviewCard } from "./overview-card";
import type { OverviewRead } from "./use-home-overview-reads";
import styles from "./overview.module.css";

const NO_MARKS: TokenSpendReport["marks"] = [];

/**
 * Tokens the operator's agents spent per local day. The figure is a floor and says so: the desktop
 * reports in rounded-down buckets and an ended run's last stretch is never pushed, so it reads
 * "At least", and `formatTokens` floors rather than rounds.
 */
function TokenDays({ report }: { report: TokenSpendReport }) {
  const days = windowDays(TOKEN_SPEND_WINDOW_DAYS);
  const { byDay, total, runs } = bucketByLocalDay(report.marks ?? NO_MARKS, days);
  if (runs === 0) return <EmptyState variant="outline" title="No agent has spent tokens" />;
  return (
    <>
      <div className="flex items-baseline gap-1.5">
        <span className={styles.figure}>At least {formatTokens(total)}</span>
        <span className="text-text-muted">
          {runs} {runs === 1 ? "session" : "sessions"}
        </span>
      </div>
      <Bars
        bars={days.map((day) => {
          const tokens = byDay.get(day) ?? 0;
          return { key: day, value: tokens, label: `${localDayLabel(day)} · ${formatTokens(tokens)} tokens` };
        })}
        label={`Tokens per day, last ${TOKEN_SPEND_WINDOW_DAYS} days`}
      />
      {report.truncated && (
        <p className={styles.note}>Older sessions in this window are not included.</p>
      )}
    </>
  );
}

export function TokensCard({ spend }: { spend: OverviewRead<TokenSpendReport> }) {
  return (
    <OverviewCard
      title="Tokens"
      className={styles.slotTokens}
      aside={<span className="text-text-muted">{TOKEN_SPEND_WINDOW_DAYS} days</span>}
    >
      {spend.data ? (
        <TokenDays report={spend.data} />
      ) : spend.error ? (
        <p className={styles.note}>Couldn&apos;t load token spend.</p>
      ) : (
        <Skeleton className="h-16 w-full rounded-md" />
      )}
    </OverviewCard>
  );
}
