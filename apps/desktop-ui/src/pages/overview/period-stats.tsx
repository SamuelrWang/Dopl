import type { ComponentType } from "react";
import { ArrowDown, Coins, Wallet, Zap } from "lucide-react";
import { CardLabel, IconTile, KebabButton, StatFigure } from "./overview-bits";
import { PERIOD_LABEL, PERIOD_STATS, type PeriodStat } from "./overview-data";

const ICONS: Record<PeriodStat["icon"], ComponentType<{ size?: number }>> = {
  credits: Coins,
  sessions: Zap,
  balance: Wallet,
};

/**
 * The period group: one flat inset panel carrying the label, three raised cards
 * inside it. The nesting is the hierarchy — these three are scoped to a window,
 * the four above are "right now".
 */
export function PeriodStats() {
  return (
    <section className="rounded-[14px] border border-border-default bg-bg-inset p-3.5">
      <h2 className="text-label font-semibold uppercase tracking-wide text-text-secondary">
        {PERIOD_LABEL}
      </h2>
      <div className="mt-3 grid grid-cols-3 gap-3">
        {PERIOD_STATS.map((stat) => {
          const Icon = ICONS[stat.icon];
          return (
            <article key={stat.label} className="bento p-3.5">
              <div className="flex items-center gap-2.5">
                <IconTile round>
                  <Icon size={13} />
                </IconTile>
                <CardLabel>{stat.label}</CardLabel>
                <KebabButton label={`${stat.label} options`} />
              </div>
              <div className="mt-3.5 flex items-center gap-2">
                <StatFigure>{stat.value}</StatFigure>
                {stat.delta && <DeltaPill delta={stat.delta} />}
              </div>
              <p className="mt-1.5 text-caption text-text-muted">{stat.note}</p>
            </article>
          );
        })}
      </div>
    </section>
  );
}

/** Period-over-period decline. Only the falling case exists in this clone. */
function DeltaPill({ delta }: { delta: string }) {
  return (
    <span className="flex shrink-0 items-center gap-0.5 rounded-full border border-danger/25 bg-danger/10 px-1.5 py-0.5 text-caption font-medium text-danger">
      <ArrowDown size={10} aria-hidden="true" />
      {delta}
    </span>
  );
}
