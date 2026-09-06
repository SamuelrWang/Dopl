import { SectionPanel } from "@/shared/ui/section-panel";
import { Skeleton } from "@/shared/ui/skeleton";
import { useApiQuery } from "#/hooks/use-api-query";

/**
 * /home → Overview → **Token spend** — how many tokens this operator's agents
 * have spent, per day, over the last 31 days (Samuel, #1326: the per-agent
 * number "dies with the session", and he wants it "persistent knowledge in the
 * overview section").
 *
 * ⚠ **ITS OWN FILE AND ITS OWN READ**, beside `overview-panels.tsx` rather than
 * inside it: the Usage panel's card is the CREDITS story (bar + histogram, one
 * billing period, exact counts) and this is a different ledger with a different
 * accuracy story. Its loading state also must not gate anything above it — the
 * same argument `CreditsBar` makes for being its own component.
 *
 * ⚠ **THE NUMBER IS A FLOOR AND THE PANEL SAYS SO IN WORDS.** Two inherited
 * under-counts, both rounding DOWN: the desktop quantizes the reported figure to
 * 10 000-token buckets, and an ended run's final stretch is never pushed
 * (`session-state-push.js › liveForWire` drops ended rows). "At least this many"
 * is always true; "exactly this many" never is. ⚠ Do not let a later pass drop
 * that line to tidy the header — a spend figure that looks exact is one somebody
 * will reconcile against a bill.
 *
 * 🔒 **DAYS ARE THE OPERATOR'S LOCAL DAYS, AND THIS FILE IS WHERE THEY ARE
 * NAMED (Samuel's ruling, 2026-09-06).** The server sends one INSTANT per run
 * and no day at all, because it cannot know the zone; this component buckets
 * them with local calendar arithmetic. That is the re-bucket the previous
 * version of this block said was the only honest way to do it — from the raw
 * rows, never by shifting UTC labels — and it needed no migration, because the
 * ledger keeps each run's full `started_at` for exactly this.
 * ⚠ **THE COLUMNS AND THE HEADER ARE SUMMED FROM THE SAME BUCKETS.** A total
 * counted over the server's wider haul would include runs no column draws, which
 * is one card showing two numbers.
 * ⚠ **DST IS WHY THE AXIS IS BUILT WITH `new Date(y, m, d - i)` AND NOT BY
 * SUBTRACTING 86 400 000ms.** Two days a year are 23 or 25 hours long, and the
 * millisecond walk drifts across the boundary and emits one day twice.
 *
 * ⚠ **A DAY WITH NO SPEND IS ABSENT FROM THE PAYLOAD, AND THIS DRAWS IT AS AN
 * EMPTY COLUMN** — the axis is built from the window, not from the points, so a
 * quiet week reads as a quiet week instead of vanishing from the strip.
 *
 * ⚠ **NO REALTIME AND NO POLL** (INVARIANTS §7), like every read on this face.
 */
export function TokenSpendPanel() {
  const spend = useApiQuery<TokenSpendReport>("/api/home/token-spend");

  // ⚠ NOTHING AT ALL UNTIL THERE IS SOMETHING TO SAY. An operator who has never
  // run an agent must not get a heading over an empty box — the exact defect the
  // first Overview attempt was rejected for ("five giant boxes with holes where
  // the empty ones were"), and the rule the Activity panel above already
  // follows by folding itself away.
  if (spend.error) return null;
  if (!spend.isPending && (spend.data?.marks?.length ?? 0) === 0) return null;

  return (
    <SectionPanel id="home-overview-token-spend" label="Token spend">
      <section className="bento flex flex-col gap-3 p-3.5">
        {spend.isPending || !spend.data ? (
          <Skeleton className="h-[104px] w-full rounded-lg" />
        ) : (
          <TokenSpendStrip report={spend.data} />
        )}
      </section>
    </SectionPanel>
  );
}

/** The payload of `GET /api/home/token-spend` — ONE ENTRY PER RUN, newest first,
 *  and no days in it.
 *  ⚠ Mirrors `features/channels/server/service-token-spend.ts ›
 *  TokenSpendReport`; the desktop UI cannot import server types. */
type TokenSpendReport = {
  marks: Array<{ at: string; tokens: number }>;
  truncated: boolean;
};

const WINDOW_DAYS = 31;

function TokenSpendStrip({ report }: { report: TokenSpendReport }) {
  const days = windowDays(WINDOW_DAYS);
  const { byDay, total, runs } = bucketByLocalDay(report.marks, days);
  // ⚠ THE TALLEST COLUMN SETS THE SCALE, never a constant: spend spans orders of
  // magnitude between operators, and a fixed ceiling makes every strip either
  // flat or clipped. `Math.max(1, …)` keeps the divisor off zero.
  const peak = Math.max(1, ...days.map((day) => byDay.get(day) ?? 0));

  return (
    <>
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sm font-semibold text-text-primary">
          {formatTokens(total)} tokens
        </p>
        <p className="text-label text-text-secondary">
          {runs} {runs === 1 ? "session" : "sessions"} · 31 days
        </p>
      </div>

      <div className="flex h-16 items-end gap-[3px]" aria-hidden="true">
        {days.map((day) => {
          const tokens = byDay.get(day) ?? 0;
          return (
            <div
              key={day}
              className="flex-1 rounded-sm bg-accent/70"
              // ⚠ A MEASURED ZERO STILL DRAWS A HAIRLINE (2%), so "this day was
              // counted and was quiet" is visibly different from the day being
              // off the end of the window. A 0-height column is indistinguishable
              // from no column at all.
              style={{ height: `${tokens === 0 ? 2 : Math.max(6, (tokens / peak) * 100)}%` }}
            />
          );
        })}
      </div>

      {/* ⚠ THE HONESTY LINE. See this file's header — it is load-bearing, not
          decoration. */}
      <p className="text-label text-text-secondary">
        At least this many: reported spend is rounded down and a session&apos;s
        last moments are not counted.
        {report.truncated && " Older sessions in this window are not included."}
      </p>
    </>
  );
}

/**
 * ONE INSTANT → THE OPERATOR'S CALENDAR DAY, `YYYY-MM-DD`.
 *
 * ⚠ **LOCAL GETTERS, NEVER `toISOString().slice(0, 10)`** — that reads the UTC
 * day, which west of Greenwich is tomorrow's for most of the evening. This is
 * the same bug `overview-sections.tsx › binLabel` records from the other
 * direction (there, a UTC bin must NOT be parsed into local time).
 */
export function localDayKey(at: Date): string {
  const month = String(at.getMonth() + 1).padStart(2, "0");
  const day = String(at.getDate()).padStart(2, "0");
  return `${at.getFullYear()}-${month}-${day}`;
}

/**
 * The window's day keys, oldest first, in the OPERATOR'S zone.
 *
 * ⚠ **DAY ARITHMETIC, NOT MILLISECOND ARITHMETIC.** `new Date(y, m, d - i)`
 * normalises across month and year ends AND across DST: a 23-hour day walked by
 * 86 400 000ms lands at 23:00 the previous evening and repeats a key.
 */
export function windowDays(count: number): string[] {
  const now = new Date();
  const out: string[] = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    out.push(
      localDayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - i))
    );
  }
  return out;
}

/**
 * RUNS → THE COLUMNS THEY BELONG IN, plus the header's two figures.
 *
 * ⚠ **A MARK OUTSIDE THE DRAWN WINDOW IS DROPPED FROM EVERYTHING, INCLUDING THE
 * TOTAL.** The server hauls a slightly WIDER window than 31 local days on
 * purpose (`api/home/token-spend/route.ts`), so the oldest column is never
 * short — and a run that falls off the front of the axis must not be summed into
 * a header the strip beneath it cannot show. The header says "31 days"; this is
 * what makes that sentence true.
 */
export function bucketByLocalDay(
  marks: ReadonlyArray<{ at: string; tokens: number }>,
  days: readonly string[]
): { byDay: Map<string, number>; total: number; runs: number } {
  const inWindow = new Set(days);
  const byDay = new Map<string, number>();
  let total = 0;
  let runs = 0;
  for (const mark of marks) {
    const at = new Date(mark.at);
    // ⚠ AN UNPARSEABLE INSTANT IS DROPPED, not bucketed as today: this payload
    // is IndexedDB-persisted (§8), so a row written by an older bundle can
    // arrive in a shape this build does not read, and `NaN` would take the whole
    // strip's scale with it.
    if (Number.isNaN(at.getTime())) continue;
    const key = localDayKey(at);
    if (!inWindow.has(key)) continue;
    byDay.set(key, (byDay.get(key) ?? 0) + mark.tokens);
    total += mark.tokens;
    runs += 1;
  }
  return { byDay, total, runs };
}

/** ⚠ ROUNDED FOR DISPLAY ONLY, and never up: the underlying figure is already a
 *  floor, so rounding up here would turn an under-count into an over-claim. */
export function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${Math.floor(tokens / 100_000) / 10}M`;
  if (tokens >= 1_000) return `${Math.floor(tokens / 1_000)}k`;
  return String(tokens);
}
