import { SectionPanel } from "@/shared/ui/section-panel";
import { Skeleton } from "@/shared/ui/skeleton";
import { useWorkspaceEntitlements } from "@/features/billing/components/use-workspace-entitlements";
import {
  EMPTY_AGENTS,
  EMPTY_CHANNEL_USAGE,
  EMPTY_PERSON_USAGE,
  EMPTY_SERIES,
  EMPTY_TOOL_USAGE,
  HOME_OVERVIEW_DEFAULT_METRIC,
  HOME_OVERVIEW_DEFAULT_RANGE,
  type HomeOverview,
  type HomeOverviewSeries,
  type HomeSeriesPoint,
} from "@/features/home/overview-types";
import { useApiQuery } from "#/hooks/use-api-query";
import { PageError } from "#/components/page-states";
import { CreditCapacityBar, UsageChart, seriesTotal } from "./overview-sections";
import {
  ChannelMessageRail,
  ChannelRail,
  ClippedNote,
  PeopleRail,
  ToolRail,
} from "./overview-rails";
import type { OpenActivity } from "./use-activity-jump";
import { ActiveAgentBoard } from "./overview-agent-board";
import { TokenSpendPanel } from "./overview-token-spend";

/**
 * /home → Overview — the account surface's analytics face (2026-09-01, Samuel).
 *
 * 🔒 **ONE PAYLOAD, ONE SET OF SECTIONS — AND THAT IS THE DUPLICATION FIX.**
 * This face used to stack an ACCOUNT-wide panel over a CHANNEL-SCOPED one built
 * from the same components against `?workspaceId=`. For an operator whose fence
 * holds ONE home channel the two payloads are identical by construction, so
 * every stat tile, chart and rail rendered TWICE. The scoped panel, its param
 * and the `scope` field are all gone. ⚠ **Do not reintroduce a channel-scoped
 * panel here** — the left list scopes the CHANNELS face; Overview is about the
 * account, and every section on it is cross-channel by construction.
 *
 * 🔒 **TWO DENSE PANELS OF BENTO CARDS — NOT A COLUMN OF FULL-WIDTH STRIPS
 * (Samuel, 2026-09-01, live review: "this looks so bad, the other one looked so
 * much better").** The first rebuild gave every section its own full-width
 * `SectionPanel`, so the page became five giant boxes with holes where the empty
 * ones were. **The grid is the spec**: ACTIVITY is the agent board alone (its
 * two cards were cut 2026-09-05 and the panel now folds away with them when no
 * agent is running); USAGE is the capacity bar beside the chart over two rows of
 * rails. Cards are sized to content and empty ones say so in one line.
 * ⚠ **The panel is the GROUPING, the card is the surface.** A section that
 * wants to be a full-width strip needs a reason that is not "it has a heading".
 *
 * ⚠ **NO RANGE SWITCHER.** The window is the current month
 * (`HOME_OVERVIEW_DEFAULT_RANGE`), which is also the credit period the capacity
 * bar describes — so the bar, the histogram and the credit rails answer for the
 * same window instead of three nearby ones.
 *
 * ⚠ **NO REALTIME AND NO POLL** (INVARIANTS §7): this is a cold read, and the
 * provider's `staleTime` is the freshness story.
 */
export function HomeOverviewPanels({
  homeWorkspaceId,
  onOpenActivity,
}: {
  /**
   * The caller's own workspace from `POST /api/boot`, for the credit bar.
   * ⚠ NULL until the caller is onboarded; the bar says nothing rather than
   * asking about a workspace that does not exist.
   */
  homeWorkspaceId: string | null;
  /**
   * Open a thread (or a channel, for a channel-level agent) from an activity
   * row. ⚠ THE PAGE OWNS THE ACT — a home channel has no route of its own, so
   * "navigate" here is: select that row and raise the Channels face. See
   * `use-activity-jump.ts`.
   */
  onOpenActivity: OpenActivity;
}) {
  const overview = useApiQuery<HomeOverview>(
    `/api/home/overview?range=${HOME_OVERVIEW_DEFAULT_RANGE}`,
    { keepPreviousData: true }
  );

  if (overview.error) {
    return (
      <div className="flex min-w-0 flex-1 flex-col">
        <PageError
          error={overview.error}
          onRetry={() => void overview.refetch()}
        />
      </div>
    );
  }

  const data = overview.data;
  // ⚠ `?? EMPTY_X` INLINE AT EVERY READ (§8): this payload is IndexedDB-
  // persisted, so an entry written by an older bundle can lack a key this one
  // `.map`s over — and `.map` on `undefined` THROWS and blanks the whole pane.
  const agents = data?.agents ?? EMPTY_AGENTS;

  return (
    <div className="min-w-0 flex-1 overflow-y-auto p-3">
      <div className="flex flex-col gap-3">
        {/* ⚠ **THE WHOLE PANEL FOLDS AWAY WHEN NOTHING IS RUNNING (Samuel,
            2026-09-05).** **Waiting on you** and **Recent threads** were CUT
            from this pane — the ruling is that Activity carries running agents
            and nothing else — and the board was already the only other thing in
            it. So the guard moved OUT to the `SectionPanel`: with the cards gone
            an `agents.length === 0` render would have been a heading over an
            empty box, which is the exact defect the first Overview attempt was
            rejected for ("five giant boxes with holes where the empty ones
            were"). An empty state must not cost a full-width strip.
            ⚠ **AND THERE IS NO SKELETON HERE ANY MORE.** The two-card
            `ActivityGhost` was sized to the deleted cards, and a ghost for a
            panel that may legitimately not render at all is a promise the data
            need not keep — it would flash a box and then remove it for every
            operator with no agents running. This section renders NOTHING until
            the payload lands. */}
        {agents.length > 0 && (
          <SectionPanel id="home-overview-activity" label="Activity">
            {/* ⚠ A `<section>`, not a `<div>`: the board's heading has to BOUND
                it, so a query scoped to "Active agents" cannot widen to the
                whole panel. */}
            <section className="flex flex-col gap-2">
              <h3 className="px-1 text-label font-semibold uppercase tracking-wide text-text-secondary">
                Active agents
              </h3>
              <ActiveAgentBoard rows={agents} onOpen={onOpenActivity} />
            </section>
          </SectionPanel>
        )}

        {/* 🔒 **THE LAYERING IS THE PAGE'S, NOT THIS PANEL'S OWN (Samuel,
            verbatim: "White panel background, then there's the gray background,
            then white panel on top. That's how everything else is").** Three
            layers, every section: page ground → GRAY `SectionPanel` → WHITE
            `.bento` card holding the content. ⚠ **A previous pass forced
            `!bg-home-card` onto the SectionPanel itself**, which painted the
            panel white and dropped the bar and the plot straight onto it — one
            layer short, and the only section on the face that did not match its
            siblings. The override is GONE: this panel is the same gray as
            `All channels` beside it.
            ⚠ **ONE CARD, and it is the SAME `.bento` recipe the rail cards
            wear** (`overview-rails.tsx › RailCard`), so the two panels layer
            identically by construction rather than by two class strings that
            happen to agree today.
            ⚠ **NOTHING ELSE IN THE PANEL** — the bar on top, the histogram
            under it, both inside that one card. A rail, a note or a total goes
            in the panel below. */}
        <SectionPanel id="home-overview-usage" label="Usage">
          <UsageCard homeWorkspaceId={homeWorkspaceId} />
        </SectionPanel>

        {/* ⚠ **TOKEN SPEND IS ITS OWN PANEL, NOT A THIRD THING IN THE USAGE
            CARD** (2026-09-06, Samuel #1326). That card is the CREDITS story —
            one billing period, exact counts — and this is a different ledger
            with a different accuracy story (a floor, and a 31-day window rather
            than the credit period). The panel folds itself away when no agent
            has ever spent anything, exactly as Activity does. */}
        <TokenSpendPanel />

        {/* The comparison rails — OUTSIDE Usage, same card styling as before. */}
        <SectionPanel id="home-overview-breakdown" label="All channels">
          {data ? (
            <div className="flex flex-col gap-3">
              <div className="grid grid-cols-2 gap-3">
                <ChannelRail rows={data.channels ?? EMPTY_CHANNEL_USAGE} />
                <ChannelMessageRail rows={data.channels ?? EMPTY_CHANNEL_USAGE} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <PeopleRail rows={data.people ?? EMPTY_PERSON_USAGE} />
                <ToolRail rows={data.tools ?? EMPTY_TOOL_USAGE} />
              </div>
              {data.truncated && <ClippedNote scanned={data.scanned} />}
            </div>
          ) : (
            <RailsGhost />
          )}
        </SectionPanel>
      </div>
    </div>
  );
}

/**
 * THE USAGE CARD — the bar over the histogram, and **ONE READ BEHIND BOTH**
 * (Samuel's ruling #10, 2026-09-06).
 *
 * 🔒 **THE SERIES IS FETCHED HERE, NOT IN THE CHART, BECAUSE THE BAR'S SPENT
 * FIGURE IS THE SERIES' OWN SUM.** The bar used to print the PAYER's period
 * counter while the plot under it summed the attribution ledger, so one card
 * showed two numbers for one month — and on a reading whose payer never resolved
 * the bar said "Not counted this period" over a plot full of bars. Hoisting the
 * read makes them the same array through `seriesTotal`, which is agreement by
 * construction; two components reading the same cache key would only be
 * agreement by coincidence.
 * ⚠ **IT IS NOT A SECOND READ.** This is the request `CreditsChart` was already
 * making, moved up one level — same path, same key, same `keepPreviousData`. No
 * new endpoint and no second summing query on the server: the histogram's read
 * path is the whole source (`service-overview.ts › getHomeOverviewSeries`).
 *
 * 🔒 **PINNED TO `credits` — THERE IS NO METRIC STATE AND NO SWITCHER**
 * (Samuel: "I explicitly said not to do MCP calls but credits"). The page asks
 * for exactly one series. `HOME_OVERVIEW_DEFAULT_METRIC` is that pin; the ROUTE
 * still validates all three metrics, because it is a general endpoint with its
 * own tests.
 */
function UsageCard({ homeWorkspaceId }: { homeWorkspaceId: string | null }) {
  const series = useApiQuery<HomeOverviewSeries>(
    `/api/home/overview-series?range=${HOME_OVERVIEW_DEFAULT_RANGE}&metric=${HOME_OVERVIEW_DEFAULT_METRIC}`,
    { keepPreviousData: true }
  );
  // ⚠ `?? EMPTY_SERIES` INLINE (§8): an IndexedDB-persisted entry written by an
  // older bundle can lack `points`, and the reduce below would throw on it.
  const points = series.data?.points ?? EMPTY_SERIES;
  return (
    <section className="bento flex flex-col gap-4 p-3.5">
      <CreditsBar
        homeWorkspaceId={homeWorkspaceId}
        points={points}
        ledgerPending={series.isPending && !series.data}
      />
      <UsageChart
        points={points}
        bucket={series.data?.bucket ?? "day"}
        loading={series.isPending}
        truncated={series.data?.truncated ?? false}
      />
    </section>
  );
}

/**
 * The allowance bar, at the top of the Usage panel and across its full width.
 *
 * ⚠ **ITS OWN COMPONENT BECAUSE IT HAS ITS OWN READ** — `GET /api/billing/status`
 * through the SAME hook the settings modal's billing pane uses, so one cache
 * entry serves both and the bar costs no second credits read. Keeping it here
 * means its loading state does not gate the plot under it.
 * ⚠ **THE SPEND ARRIVES AS A PROP** — see `UsageCard`. That read is the plot's,
 * and this component must not start a second one.
 */
function CreditsBar({
  homeWorkspaceId,
  points,
  ledgerPending,
}: {
  homeWorkspaceId: string | null;
  points: readonly HomeSeriesPoint[];
  /** The ledger read has not landed AND there is no previous series to stand
   *  in — see the ghost below. */
  ledgerPending: boolean;
}) {
  const credits = useWorkspaceEntitlements(homeWorkspaceId ?? undefined);
  // ⚠ A GHOST OF THE BAR'S OWN HEIGHT while either read is in flight, and when
  // the caller has no workspace yet — never a zeroed bar, which would claim a
  // spent allowance nobody measured. ⚠ THE LEDGER READ IS NOW ONE OF THOSE
  // GATES, and it has to be: the spend comes from it, so rendering ahead of it
  // would paint a confident `0 of 500 credits spent` and then jump. A KEPT
  // previous series is not pending by this test, so a refetch never re-ghosts a
  // bar that already has a figure — the same trade the plot makes when it dims
  // instead of blanking.
  if (credits.loading || !homeWorkspaceId || ledgerPending) {
    return <Skeleton className="h-[54px] w-full rounded-lg" />;
  }
  // ⚠ THE PLAN RIDES ALONG BECAUSE THE BAR'S DENOMINATOR NEEDS IT: a reading
  // whose payer never resolved carries `limit: 0`, and the plan's allowance is
  // what stands in for it (`overview-sections.tsx › CreditCapacityBar`). Same
  // payload, same read — it costs nothing extra.
  return (
    <CreditCapacityBar
      credits={credits.credits}
      plan={credits.plan}
      spent={seriesTotal(points)}
    />
  );
}

function RailsGhost() {
  return (
    <div className="grid grid-cols-2 gap-3">
      {Array.from({ length: 4 }).map((_, index) => (
        <Skeleton key={index} className="h-40 rounded-[14px]" />
      ))}
    </div>
  );
}
