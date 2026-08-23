import type { ComponentType } from "react";
import { Coins, Wallet } from "lucide-react";
import type { WorkspaceCreditsStatus } from "@/features/billing/components/use-workspace-entitlements";
import { CardLabel, IconTile, StatFigure } from "./overview-bits";

/**
 * The period group: one flat inset panel carrying the label, the credit cards
 * inside it. The nesting is the hierarchy — these are scoped to a window, the
 * four above are "right now".
 *
 * ⚠ The window is the BILLING PERIOD, not a rolling 30 days: the meter is
 * `/api/billing/status`, whose counter resets on the subscription anchor. The
 * clone's third card ("Sessions") and its delta pills are DELETED — no
 * period-over-period figure exists to put in one.
 */

const PERIOD_LABEL = "This billing period";

interface CreditCard {
  label: string;
  value: number;
  note: string;
  Icon: ComponentType<{ size?: number }>;
}

/** `12 Sep` in the viewer's locale; null when the summary carried no window
 *  (the entitlements fallback leaves the bounds blank rather than invent one). */
function resetDay(iso: string): string | null {
  if (!iso) return null;
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  return at.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

export function PeriodStats({ credits }: { credits: WorkspaceCreditsStatus }) {
  const resets = resetDay(credits.periodEnd);
  const cards: CreditCard[] = [
    {
      label: "Credits used",
      value: credits.used,
      note: `of ${credits.limit.toLocaleString()} allowed`,
      Icon: Coins,
    },
    {
      label: "Credits left",
      value: credits.remaining,
      note: resets ? `Resets ${resets}` : "In the current allowance",
      Icon: Wallet,
    },
  ];

  return (
    <section className="rounded-[14px] border border-border-default bg-bg-inset p-3.5">
      <h2 className="text-label font-semibold uppercase tracking-wide text-text-secondary">
        {PERIOD_LABEL}
      </h2>
      <div className="mt-3 grid grid-cols-2 gap-3">
        {cards.map(({ label, value, note, Icon }) => (
          <article key={label} className="bento p-3.5">
            <div className="flex items-center gap-2.5">
              <IconTile round>
                <Icon size={13} />
              </IconTile>
              <CardLabel>{label}</CardLabel>
            </div>
            <div className="mt-3.5 flex items-center gap-2">
              <StatFigure>{value.toLocaleString()}</StatFigure>
            </div>
            <p className="mt-1.5 text-caption text-text-muted">{note}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
