import type { ReactNode } from "react";
import { cn } from "@/shared/lib/utils";
import { ThinMeter } from "@/shared/ui/usage-meter";
import { OVER_METER, creditAllowance } from "./overview-credits";
import { needsCount } from "./overview-needs";
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
  needs,
}: Pick<HomeOverviewReads, "wallet" | "devices" | "needs">) {
  const allowance = wallet.loading ? null : creditAllowance(wallet.credits);
  const rows = devices.failed ? null : devices.devices;
  return (
    <section className={cn("white-card", styles.card, styles.strip)} aria-label="Summary">
      <Cell label="Need you" value={needsCount({ wallet, needs }) ?? UNKNOWN} />
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
