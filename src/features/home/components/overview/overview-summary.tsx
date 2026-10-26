import type { ReactNode } from "react";
import { Zap } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { EmptyState } from "@/shared/ui/empty-state";
import { Skeleton } from "@/shared/ui/skeleton";
import { ThinMeter } from "@/shared/ui/usage-meter";
import { CARD_INK_PILL, OverviewCard } from "./overview-card";
import { OVER_METER, creditAllowance } from "./overview-credits";
import type { HomeOverviewReads } from "./use-home-overview-reads";
import styles from "./overview.module.css";

const UNKNOWN = "—";

function Cell({
  label,
  value,
  of,
  children,
}: {
  label: string;
  value: string;
  of?: string;
  children?: ReactNode;
}) {
  return (
    <div className={styles.cell}>
      <span className={styles.cellLabel}>{label}</span>
      <span className={styles.figure}>
        {value}
        {of && <span className={styles.of}>{of}</span>}
      </span>
      {children}
    </div>
  );
}

/** Need you · Devices online · Credits left. A read that has not landed shows a dash, never 0. */
export function SummaryStrip({
  wallet,
  devices,
}: {
  wallet: HomeOverviewReads["wallet"];
  devices: HomeOverviewReads["devices"];
}) {
  const allowance = wallet.loading ? null : creditAllowance(wallet.credits);
  const rows = devices.failed ? null : devices.devices;
  return (
    <section className={cn("white-card", styles.card, styles.strip)} aria-label="Summary">
      <Cell label="Need you" value={allowance ? String(allowance.over ? 1 : 0) : UNKNOWN} />
      <Cell
        label="Devices online"
        value={rows ? String(rows.filter((device) => device.online).length) : UNKNOWN}
        of={rows ? `/ ${rows.length}` : undefined}
      />
      <Cell
        label="Credits left"
        value={allowance ? allowance.left.toLocaleString() : UNKNOWN}
        of={allowance ? `/ ${allowance.limit.toLocaleString()}` : undefined}
      >
        {allowance && (
          <ThinMeter
            used={allowance.used}
            limit={allowance.limit}
            color={allowance.over ? OVER_METER : null}
          />
        )}
      </Cell>
    </section>
  );
}

/** What is waiting on the operator. The product's one such state is a spent allowance. */
export function NeedsCard({
  wallet,
  onGetCredits,
}: {
  wallet: HomeOverviewReads["wallet"];
  onGetCredits: () => void;
}) {
  const over = !wallet.loading && creditAllowance(wallet.credits).over;
  return (
    <OverviewCard
      title="Needs you"
      count={wallet.loading ? undefined : over ? 1 : 0}
      className={styles.slotNeeds}
    >
      {wallet.loading ? (
        <Skeleton className="h-10 w-full rounded-md" />
      ) : over ? (
        <ul className={styles.rows}>
          <li className={styles.row}>
            <span className={styles.mark} data-tone="over" aria-hidden="true">
              <Zap size={13} />
            </span>
            <span className={styles.rowMain}>
              <span className={styles.rowTitle}>Out of credits</span>
              <span className={styles.rowMeta}>Tool calls are paused until the next period</span>
            </span>
            {!wallet.isPaid && (
              <button type="button" className={CARD_INK_PILL} onClick={onGetCredits}>
                Get more credits
              </button>
            )}
          </li>
        </ul>
      ) : (
        <EmptyState variant="outline" title="Nothing waiting" />
      )}
    </OverviewCard>
  );
}
