import type { ReactNode } from "react";
import { cn } from "@/shared/lib/utils";
import { UsageMeter } from "@/shared/ui/usage-meter";
import { formatDate } from "@/shared/lib/format-time";
import { PERSONAL_MONTHLY_CREDITS } from "@/features/billing/credits";
import type { WorkspaceCreditsStatus } from "@/features/billing/components/use-workspace-entitlements";
import type {
  HomeOverviewBucket,
  HomeSeriesPoint,
} from "@/features/home/overview-types";
import {
  BarSeries,
  monthDayLabel,
  type BarPoint,
} from "#/components/charts/bar-series";
import { PAGE_ACTION_BTN } from "./panel-buttons";

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
 * lone figure over an empty track with **Unmetered** under it. The allowance is
 * a CONSTANT and is known either way, so it stands in. ⚠ **NEVER A LITERAL
 * HERE** — it is imported, so a retune in `credits.ts` moves this bar with it.
 *
 * 🔒 **AND THE CONSTANT IS THE *PERSONAL* WALLET'S FREE TIER, NOT A WORKSPACE
 * PLAN'S (2026-09-07; `.free` since 2026-09-08).** ⚠ `PERSONAL_MONTHLY_CREDITS`
 * became a two-key map when the personal Pro tier landed, and FREE is the right
 * key for a STAND-IN: this arm only runs when the payload's own `limit` is 0,
 * i.e. nothing was measured, and quoting the paid allowance to someone who may
 * not pay is the direction that misleads. A Pro reader's real 5,000 arrives on
 * `credits.limit` and never reaches this line. /home is the HOME SPACE: every call this face charges lands on
 * the reader's own personal wallet, whose allowance is
 * `billing/credits.ts › PERSONAL_MONTHLY_CREDITS` — one tier, no plan to look
 * up. It used to fall back to `monthlyCreditsForPlan(plan)`, the WORKSPACE
 * allowance for the plan of whichever container answered, which is a number
 * from the wrong meter entirely; the `plan` prop went with it. A workspace
 * seat's denominator belongs on the billing surface, which reads it from the
 * status payload's own `limit`.
 *
 * ⚠ **AND THE SPENT SENTENCE IS GONE AS OF 2026-09-13** (Samuel, over this card:
 * *"under the bar … '0 of 500 credits spent'. Can you remove that line"*). It
 * existed to say WHICH of the meter's two numbers was which; the card is headed
 * **Credit spend** now, so the pair reads as spend against allowance without it.
 * ⚠ **THAT HEADING IS THE CALLER'S** (`overview-panels.tsx › UsageCard`), like
 * the `.bento` frame and for the same reason: this component owns the BAR, and a
 * heading here would also be one the bar's skeleton could hide.
 * ⚠ **THE OTHER TWO FACTS ARE UNCHANGED AND STILL REQUIRED** — credits left, and
 * the reset date.
 *
 * 🔒 **THE SPENT FIGURE IS THE WALLET COUNTER — THE SAME `credits.used` SETTINGS
 * PRINTS (Samuel, 2026-09-12: "is the credits usage wired in? I want to make
 * sure").** It was `seriesTotal(points)` from ruling #10 (2026-09-06) until this
 * change, which bought agreement WITHIN this card at the cost of agreement with
 * the meter that actually charges: his bar read `416 of 500` while Settings ›
 * Plans & billing read `0 of 500`, because the series summed
 * `credit_usage_events` over every container he had burned in — 416 in a link
 * container (his personal wallet) and 56 more in a standard workspace (a SEAT
 * wallet, a different meter entirely). **One question, one number: what came out
 * of MY personal wallet.** The wallet is the only thing that can answer it,
 * because the wallet is what enforcement decremented.
 * ⚠ **AND THE PLOT UNDER THIS BAR STILL TOTALS IT** — not by sharing an array
 * any more, but because the SERVER narrowed the credits series to the same
 * wallet's ledger rows (`features/home/server/overview-tally.ts ›
 * isPersonalWalletBurn`, pushed into the read by
 * `repository-overview.ts › scanCreditEvents`). Two derivations of one quantity,
 * which is agreement that survives somebody editing one of them — a wrong sum
 * now shows up as a plot that does not match its own bar.
 * ⚠ **IT IS THE BILLING PANE'S FIGURE, ON PURPOSE.** `billing-usage-pane.tsx`
 * and this bar are two views of ONE counter now; the previous note here said
 * they answer different questions and that difference was the defect.
 *
 * ⚠ **`degraded` STILL GOVERNS THE DENOMINATOR AND THE DATE, NOT THE SPEND.** A
 * payer that never resolved answers `used: 0, limit: 0, degraded: true`: the
 * limit falls back to the personal-wallet constant above, the reset date is
 * withheld by its own blank-`periodEnd` guard below, and the numerator prints the
 * measured 0 — the same 0 Settings prints, which is the agreement this change is
 * for. ⚠ **"Not counted this period" STAYS GONE**: the sentence always has a
 * number in it now.
 * ⚠ **THE FIGURE IS A COUNTER AND THE PLOT IS A LEDGER, AND THE LEDGER IS THE
 * LOOSER OF THE TWO** — its scan is capped (`scanCreditEvents`) and an unreadable
 * ledger degrades to zero rows, so the plot can sit BELOW this bar without the
 * bar being wrong. That direction is expected; the reverse would be a bug.
 * ⚠ **"Its writer is fire-and-forget" IS DELETED, NOT SOFTENED (F-693):** the
 * row is written inside the counter's own transaction now, which is why a
 * residual difference is worth PRINTING (`Unreconciled`, below) rather than
 * shrugging at.
 *
 * ⚠ **A DENOMINATOR IS NOT A MEASUREMENT (INVARIANTS §11)** — hence the
 * personal-wallet constant standing in for a 0 `limit`, above.
 * ⚠ `over` IS STILL THE PAYLOAD'S VERDICT AND MUST STAY THERE: being out of
 * credits is a fact about the PAYER's counter (it is what pauses tool calls),
 * not about this ledger, and deriving it from `spent >= limit` would put a
 * warning under a bar nothing has actually stopped.
 */
export function CreditCapacityBar({
  credits,
  spent,
  onUpgrade,
}: {
  credits: WorkspaceCreditsStatus;
  /** This period's spend off the WALLET COUNTER — `/api/billing/status ›
   *  credits.used`, the figure Settings prints. ⚠ NOT the histogram's sum; see
   *  this component's docblock for the measurement that moved it. */
  spent: number;
  /**
   * Opens the settings modal on its billing section. ⚠ **ABSENT MEANS THERE IS
   * NOTHING TO SELL** — the caller passes it only on a FREE home container
   * (`overview-panels.tsx › CreditsBar`), so this component never has to know
   * what a plan is. Minimal copy (INVARIANTS §5): the affordance is one word.
   */
  onUpgrade?: () => void;
}) {
  const exhausted = credits.remaining === 0 && credits.limit > 0;
  const limit =
    credits.limit > 0 ? credits.limit : PERSONAL_MONTHLY_CREDITS.free;
  // ⚠ Derived from the limit ABOVE, not `credits.remaining`: on a degraded row
  // the payload's remaining is a zero against a zero, and pairing it with the
  // constant would read as a spent allowance nobody measured.
  const remaining = Math.max(0, limit - spent);
  return (
    // ⚠ `w-full` AND NO CARD FRAME OF ITS OWN: the CARD is the caller's
    // (`overview-panels.tsx › UsageCard` wraps this in the `.bento` Samuel's
    // two-panel ruling asked for), so a frame here would be a box in a box.
    <div className="w-full">
      {/* ⚠ **NO LABEL ON THE METER (Samuel, 2026-09-13: *"for the usage credits,
          remove the credits and the 'Credits used' text"*).** The `used / limit`
          pair stays — it is the measurement — and the word "Credits" that stood
          to its left is gone from both this card and the histogram's header. The
          card is inside a panel titled **Usage**; a noun on every row inside it
          restates the panel. */}
      <UsageMeter
        className=""
        used={spent}
        limit={limit}
        over={exhausted}
        overNote="Tool calls are paused until the next period."
      />
      <div className="mt-2 flex items-baseline justify-between gap-3 text-caption text-text-muted">
        {/* 🔒 **THE "N of N credits spent" LINE IS DELETED (Samuel, 2026-09-13:
            *"under the bar … '0 of 500 credits spent'. Can you remove that
            line"*).** It restated the meter's own `used / limit` header one row
            below it — the header is the measurement, and with **Credit spend**
            now naming the card the sentence said the same thing a third time.
            ⚠ **The two facts beside it STAY**: what is left, and when it resets.
            Do not re-add the sentence to "explain" the pair. */}
        <span>{remaining.toLocaleString()} left</span>
        {/* 🔒 **THE RECONCILIATION CAPTION — ONE MUTED WORD, AND NOTHING AT ALL
            WHEN THE TWO AGREE (Samuel, 2026-09-13: *"there's a disconnect between
            the two charts. we need to nail this down"*; F-693).** This bar is the
            COUNTER and the plot below it is the LEDGER; `ledgerDrift` is the
            server's own subtraction of the two for this wallet and period
            (`billing/server/credits-audit.ts › walletMatchesLedger`). **0 renders
            NOTHING** — a badge that is always there is furniture, and the
            agreement is the normal state.
            ⚠ **MINIMAL COPY (INVARIANTS §5): the word, not the number.** The
            figure belongs in the payload and the logs, not on a card whose whole
            point is that two numbers already fight for attention on it. Do not
            grow this into "off by 3" or a tooltip explaining the ledger.
            ⚠ **NOT DERIVED FROM `spent` AND THE PLOT'S OWN TOTAL.** The plot is a
            capped, wallet-narrowed scan, so it legitimately reads LOW; comparing
            the two client-side would flag every clipped month. Only the server can
            subtract the ledger from the counter. */}
        {credits.ledgerDrift !== 0 && <span>Unreconciled</span>}
        {/* ⚠ THE SAME LINE THE BILLING PANE PRINTS, and the same guard: the
            period bounds are blank on the degraded fallback status, and a date
            nobody measured must not be invented here. */}
        {credits.periodEnd && <span>Resets {formatDate(credits.periodEnd)}</span>}
      </div>
      {/* 🔒 **THE OFFER IS THE PAGE'S BLACK BUTTON, BELOW THE BAR** (Samuel,
          2026-09-13: *"change the upgrade button to be more like the new channel
          button, like the black background stuff. Change it to … 'Get more
          credits'"*, then *"move Get More Credits below the bar. Right now, it's
          above the bar. It should be below the bar"*). It was a one-word text
          action in the caption row (2026-09-08). ⚠ **`panel-buttons.tsx ›
          PAGE_ACTION_BTN` BY IMPORT** — the "New channel" button's own class
          list, so the two cannot drift; never a re-typed `h-9 auth-btn-3d`.
          ⚠ **THE `!isPaid` RULE IS UNCHANGED**: the caller passes `onUpgrade`
          only when there is something to buy. */}
      {onUpgrade && (
        <div className="mt-2.5 flex justify-end">
          <button type="button" onClick={onUpgrade} className={PAGE_ACTION_BTN}>
            Get more credits
          </button>
        </div>
      )}
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
 * `at` → the bin's caption. Hour bins print `HH:00`; day bins delegate to
 * `charts/bar-series.tsx › monthDayLabel`, the ONE `m/d` formatter (the other
 * caller is `pages/overview/activity-chart.tsx`).
 */
function binLabel(at: string, bucket: HomeOverviewBucket): string {
  if (bucket === "hour") return `${at.slice(11, 13)}:00`;
  return monthDayLabel(at);
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
  scopeControl,
  monthControl,
}: {
  points: readonly HomeSeriesPoint[];
  bucket: HomeOverviewBucket;
  /** Dim the plot while the next read lands — the previous series stays up
   *  rather than dropping the card to a gate. */
  loading: boolean;
  /** The credit haul came back AT its ceiling, so the bars are a floor. */
  truncated: boolean;
  /**
   * THE SCOPE DROPDOWN, WHERE THE **Credits used** HEADING WAS (Samuel,
   * 2026-09-13). ⚠ A SLOT, not a control this component owns: the selection
   * decides the caller's READ PATH (`overview-usage-filter.tsx ›
   * usageSeriesPath`), so the state has to live with the fetch. This file still
   * renders a plot and owns no words.
   */
  scopeControl?: ReactNode;
  /** The month arrows + label, same slot rule. ⚠ THEY MOVE THIS PLOT ONLY — the
   *  capacity bar above is the wallet's CURRENT period, always. */
  monthControl?: ReactNode;
}) {
  const total = seriesTotal(points);
  const bars: BarPoint[] = points.map((point) => ({
    key: point.at,
    label: binLabel(point.at, bucket),
    value: point.count,
  }));

  return (
    // ⚠ A `<div>`, NOT A `<section>`: the CARD around this plot is the named
    // region now (`overview-panels.tsx › UsageCard`), and a second unnamed
    // section inside it is a landmark with nothing to say.
    <div className="min-w-0">
      {/* 🔒 **THE HEADING IS GONE AND THE DROPDOWN STANDS IN ITS PLACE (Samuel,
          2026-09-13: *"remove the credits and the 'Credits used' text. Where you
          see 'Credits used', I want you to put a dropdown"*).** The row keeps its
          shape — a control on the left, the period total on the right — and the
          month arrows sit beside that total, on the histogram's own header where
          the window they move is drawn. ⚠ **THE TOTAL IS THE PLOT'S OWN BARS,
          not the wallet's counter** (`CreditCapacityBar`'s docblock carries which
          is which), so a narrowed scope or a past month makes it disagree with
          the bar above BY DESIGN. */}
      <div className="flex items-center justify-between gap-3">
        {scopeControl}
        <div className="flex min-w-0 shrink-0 items-center gap-2">
          {monthControl}
          {/* Ink, not gray — Samuel, 2026-09-08: "their font colors are black
              not gray", over the same reference the plot below clones. */}
          <span className="font-mono text-micro tabular-nums text-text-primary">
            {total.toLocaleString()}
          </span>
        </div>
      </div>
      {bars.length === 0 ? (
        // ⚠ ONLY REACHABLE IF THE READ HAS NOT LANDED. An empty LEDGER still
        // produces a full month of zero bars — see the docblock.
        <p className="mt-3 text-caption text-text-muted">Nothing yet.</p>
      ) : (
        <>
          {/* ⚠ **NO `labelEvery` SINCE 2026-09-08: EVERY BIN IS CAPTIONED.**
              The divisor that used to live here existed because horizontal
              `31/12`s did not fit; the plot slants them −45° now and a month
              fits whole (Samuel: "we should be able to fit 30 days"). */}
          <BarSeries
            points={bars}
            className={cn("mt-3 transition-opacity", loading && "opacity-60")}
          />
          {/* §9: a clipped read SAYS SO, beside the thing it clipped. */}
          {truncated && (
            <p className="mt-2 text-caption text-text-muted">Newest rows only.</p>
          )}
        </>
      )}
    </div>
  );
}
