import { cn } from "@/shared/lib/utils";
import { UsageMeter } from "@/shared/ui/usage-meter";
import { formatDate } from "@/shared/lib/format-time";
import { monthlyCreditsForPlan } from "@/features/billing/credits";
import type {
  WorkspaceCreditsStatus,
  WorkspacePlan,
} from "@/features/billing/components/use-workspace-entitlements";
import type {
  HomeOverviewBucket,
  HomeSeriesPoint,
} from "@/features/home/overview-types";
import { BarSeries, type BarPoint } from "#/components/charts/bar-series";

/**
 * The /home Overview face's USAGE panel contents — the capacity bar and the
 * month histogram under it (2026-09-01).
 *
 * 🔒 **ONE PANEL, BAR ON TOP, FULL WIDTH, HISTOGRAM BELOW (Samuel, verbatim:
 * "I want it to be on top of the graph, so still in the same panel as the
 * graph. I want it to be at the top" / "for the usage bar to be on the same
 * panel as the calls. but above it. stretching across the entire length").**
 * An earlier pass put the bar in its own card BESIDE the chart in a two-column
 * grid. That is not what was asked for and it is not what this file builds: the
 * bar is a full-width block, the plot sits under it, and there is no second
 * card.
 *
 * ⚠ **THE STAT-TILE ROW THAT USED TO LIVE HERE IS GONE.** `UsageStats`,
 * `CreditMeter` and `ChannelSummary` are deleted outright, and their server
 * reads with them (`repository-overview.ts` records which five).
 *
 * ⚠ **MINIMAL COPY (INVARIANTS §5): labels and controls, no explainer
 * paragraphs.** The one place words are unavoidable is a DENOMINATOR.
 */

/* --------------------------- the capacity bar --------------------------- */

/**
 * THIS PERIOD'S ALLOWANCE, FULL WIDTH, AT THE TOP OF THE USAGE PANEL.
 *
 * 🔒 **THIS IS THE BILLING SURFACE'S BAR, USED — NOT IMITATED (Samuel: "It
 * looks like a 3D bar almost. I think it's a pricing page, maybe. I want that
 * as well").** The reference is
 * `src/features/billing/components/billing-usage-pane.tsx › BillingUsagePane`,
 * the "Usage this period" card: a `shared/ui/usage-meter.tsx › UsageMeter`
 * labelled **Credits** (renamed from "MCP credits" 2026-09-05) over the same
 * `used`/`limit` pair, with a
 * `Resets {formatDate(periodEnd)}` line beneath. Everything visual comes from
 * that shared primitive — the label row, the recessed `.concave-track` well
 * that gives the bar its pressed-in 3D face, the bare `h-1.5 rounded-full` fill
 * on `bg-surface-cta`, and the `over` warning arm.
 *
 * ⚠ **AN EARLIER PASS APPROXIMATED IT with a hand-rolled track and an
 * `.auth-btn-3d` fill, on the reasoning that /home forbids concave surfaces.
 * That was wrong twice over** — the reference IS the spec, and the no-concave
 * sweep now records this one file as the sanctioned exception
 * (`agent-templates/components/template-editor.test.tsx › no concave
 * surfaces`), so the rule still binds every other /home surface.
 *
 * ⚠ **THREE FACTS, ALL THREE REQUIRED (Samuel: "it should show credits left. It
 * should just show when the reset date is, and then it should show the user has
 * consumed X amount of credits out of X allowance"):** the meter's own header
 * prints `used / limit`, and the line under it prints credits left and the reset
 * date. None of the three is optional.
 *
 * ⚠ `over` IS A VERDICT THE CALLER PASSES, never `used >= limit` arithmetic —
 * the same call `BillingUsagePane` makes (`remaining === 0 && limit > 0`).
 *
 * 🔒 **THE BAR ALWAYS HAS A REAL DENOMINATOR, AND IT NEVER SAYS "UNMETERED"
 * (Samuel, 2026-09-05, reversing the drop-the-bar recommendation: "I like the
 * bar. I want to keep the bar … It should be a reference number showing how
 * much it should be … it should show 416 out of 25k credits spent").** The
 * status payload's `limit` is 0 on a reading whose payer never resolved
 * (`credits-service.ts › unmetered`), and a 0 denominator is what printed a
 * lone figure over an empty track with **Unmetered** under it. The plan's
 * allowance is a CONSTANT and is known either way, so it stands in:
 * `billing/credits.ts › monthlyCreditsForPlan` — the SAME function
 * `summarizeCredits` divides by, so on a measured reading the two agree by
 * construction rather than by a second number kept in step. ⚠ **NEVER A
 * LITERAL HERE.** Samuel's own guess was 25,000 (that is TEAM); Starter is 500
 * and Pro is 10,000, and a hardcoded quota would be wrong for two plans out of
 * three the day it shipped.
 *
 * ⚠ **THE SPENT SENTENCE IS THE ASK, and it restates the meter's own header on
 * purpose** — the header is a `used / limit` pair, and what he asked for is the
 * sentence that says which is which.
 *
 * 🔒 **THE SPENT FIGURE IS THE LEDGER'S, NOT THE PAYER'S COUNTER (Samuel's
 * ruling #10, 2026-09-06).** `spent` is the sum of the very series the histogram
 * under this bar draws — `credit_usage_events` across the owner's containers
 * (`repository-overview.ts › scanCreditEvents`) — handed down by the one read
 * that already fetched it. The bar used to print `credits.used`, the PAYER's
 * period counter, so the two halves of one card answered from two sources and
 * disagreed on screen; worse, a reading whose payer never resolved carries
 * `used: 0, degraded: true` and printed **Not counted this period** over a real
 * month of bars. Now the number over the plot IS the plot's total, by
 * construction rather than by two reads agreeing.
 * ⚠ **THAT MAKES THIS FIGURE A DIFFERENT ONE FROM THE BILLING PANE'S, AND IT
 * SHOULD BE.** `billing-usage-pane.tsx` answers *what has the payer been
 * metered for*; /home answers *what did my containers spend this month*, which
 * is what this face is about. Neither is the other's cache.
 *
 * ⚠ **THE "NOT COUNTED THIS PERIOD" ARM IS GONE, DELIBERATELY, NOT MISLAID.**
 * `degraded` describes the COUNTERS, and the spend no longer comes from them, so
 * the flag can no longer say anything true about this sentence. What it still
 * governs is the reset date, which is withheld by its own blank-`periodEnd`
 * guard below.
 * ⚠ **THE FIGURE IS NO MORE HONEST THAN THE PLOT BESIDE IT, AND NO LESS.** An
 * unreadable ledger degrades to zero rows (`scanCreditEvents`, and the chart
 * then draws a flat month) — the trade Samuel took knowingly when he ruled the
 * axis is always drawn. A bar that reads 0 there is the same claim the plot is
 * making, which is the point of them sharing a source.
 *
 * ⚠ **A DENOMINATOR IS NOT A MEASUREMENT (INVARIANTS §11)** — hence the plan
 * constant standing in for a 0 `limit`, above.
 * ⚠ `over` IS STILL THE PAYLOAD'S VERDICT AND MUST STAY THERE: being out of
 * credits is a fact about the PAYER's counter (it is what pauses tool calls),
 * not about this ledger, and deriving it from `spent >= limit` would put a
 * warning under a bar nothing has actually stopped.
 */
export function CreditCapacityBar({
  credits,
  plan,
  spent,
}: {
  credits: WorkspaceCreditsStatus;
  plan: WorkspacePlan;
  /** This period's spend, summed from the histogram's own series. */
  spent: number;
}) {
  const exhausted = credits.remaining === 0 && credits.limit > 0;
  const limit = credits.limit > 0 ? credits.limit : monthlyCreditsForPlan(plan);
  // ⚠ Derived from the limit ABOVE, not `credits.remaining`: on a degraded row
  // the payload's remaining is a zero against a zero, and pairing it with a
  // plan quota would read as a spent allowance nobody measured.
  const remaining = Math.max(0, limit - spent);
  return (
    // ⚠ `w-full` AND NO CARD FRAME: this is a block at the top of the panel, not
    // a bento tile in a grid. Giving it a card back would re-create the
    // two-column layout the ruling removed.
    <div className="w-full">
      <UsageMeter
        className=""
        label="Credits"
        used={spent}
        limit={limit}
        over={exhausted}
        overNote="Tool calls are paused until the next period."
      />
      <div className="mt-2 flex items-baseline justify-between gap-3 text-caption text-text-muted">
        {/* The reference number, in words — the same figure the plot under it
            totals, because it is the same sum of the same rows. */}
        <span>
          {`${spent.toLocaleString()} of ${limit.toLocaleString()} credits spent`}
        </span>
        <span>{remaining.toLocaleString()} left</span>
        {/* ⚠ THE SAME LINE THE BILLING PANE PRINTS, and the same guard: the
            period bounds are blank on the degraded fallback status, and a date
            nobody measured must not be invented here. */}
        {credits.periodEnd && <span>Resets {formatDate(credits.periodEnd)}</span>}
      </div>
    </div>
  );
}

/* -------------------------------- chart -------------------------------- */

/**
 * The window's spend — ONE function, so the bar's sentence and the plot's own
 * header cannot be two numbers. Both callers pass the same `points` array they
 * were handed by the single read above them.
 */
export function seriesTotal(points: readonly HomeSeriesPoint[]): number {
  return points.reduce((sum, point) => sum + point.count, 0);
}

/**
 * Caption every Nth bin. ⚠ A `month` plot is 28..31 bars, so the divisor is
 * derived rather than looked up: six captions is what fits at `text-micro`.
 */
function labelEveryFor(bucket: HomeOverviewBucket, bins: number): number {
  if (bucket === "hour") return 4;
  return bins <= 7 ? 1 : Math.ceil(bins / 6);
}

/**
 * `at` → the bin's caption.
 *
 * ⚠ SLICED OUT OF THE ISO STRING, never `new Date().getDate()`: a UTC bin
 * parsed as an instant and printed in local time lands on the previous day west
 * of Greenwich, which is the bug `activity-chart.tsx › dayLabel` records.
 */
export function binLabel(at: string, bucket: HomeOverviewBucket): string {
  if (bucket === "hour") return `${at.slice(11, 13)}:00`;
  const [, month = "", day = ""] = at.slice(0, 10).split("-");
  return `${Number(day)}/${Number(month)}`;
}

/**
 * THE MONTH HISTOGRAM — **CREDITS, AND ONLY CREDITS.**
 *
 * 🔒 **NO METRIC SWITCHER (Samuel, verbatim: "I explicitly said not to do MCP
 * calls but credits. Why is there a MCP option").** This panel is about credits,
 * so the plot has one series and no pills. `MCP calls` and `Messages` are
 * removed from this chart outright — MCP traffic is still on the face as the
 * **Top MCP tools** rail and messages as the **Messages by channel** rail, which
 * is where he put them.
 *
 * 🔒 **THE AXIS IS ALWAYS DRAWN, EVEN ON AN EMPTY LEDGER (Samuel: he wants to
 * SEE the month).** The server zero-fills every day of the calendar month rather
 * than answering an empty array, so the frame never disappears and the page
 * never loses its chart. A young ledger renders a flat month that fills in as
 * burns accrue — expected, not an error state.
 */
export function UsageChart({
  points,
  bucket,
  loading,
  truncated,
}: {
  points: readonly HomeSeriesPoint[];
  bucket: HomeOverviewBucket;
  /** Dim the plot while the next read lands — the previous series stays up
   *  rather than dropping the card to a gate. */
  loading: boolean;
  /** The credit haul came back AT its ceiling, so the bars are a floor. */
  truncated: boolean;
}) {
  const total = seriesTotal(points);
  const bars: BarPoint[] = points.map((point) => ({
    key: point.at,
    label: binLabel(point.at, bucket),
    value: point.count,
  }));

  return (
    <section className="min-w-0">
      <div className="flex items-center justify-between gap-3">
        <h3 className="shrink-0 text-label font-semibold uppercase tracking-wide text-text-secondary">
          Credits used
        </h3>
        <span className="font-mono text-micro tabular-nums text-text-muted">
          {total.toLocaleString()}
        </span>
      </div>
      {bars.length === 0 ? (
        // ⚠ ONLY REACHABLE IF THE READ HAS NOT LANDED. An empty LEDGER still
        // produces a full month of zero bars — see the docblock.
        <p className="mt-3 text-caption text-text-muted">Nothing yet.</p>
      ) : (
        <>
          <BarSeries
            points={bars}
            labelEvery={labelEveryFor(bucket, bars.length)}
            className={cn("mt-3 transition-opacity", loading && "opacity-60")}
          />
          {/* §9: a clipped read SAYS SO, beside the thing it clipped. */}
          {truncated && (
            <p className="mt-2 text-caption text-text-muted">Newest rows only.</p>
          )}
        </>
      )}
    </section>
  );
}
