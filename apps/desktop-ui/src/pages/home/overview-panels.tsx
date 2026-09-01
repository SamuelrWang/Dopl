import { SectionPanel } from "@/shared/ui/section-panel";
import { Skeleton } from "@/shared/ui/skeleton";
import { useWorkspaceEntitlements } from "@/features/billing/components/use-workspace-entitlements";
import {
  EMPTY_AGENTS,
  EMPTY_ATTENTION,
  EMPTY_CHANNEL_USAGE,
  EMPTY_PERSON_USAGE,
  EMPTY_SERIES,
  EMPTY_THREADS,
  EMPTY_TOOL_USAGE,
  HOME_OVERVIEW_DEFAULT_METRIC,
  HOME_OVERVIEW_DEFAULT_RANGE,
  type HomeOverview,
  type HomeOverviewSeries,
} from "@/features/home/overview-types";
import { useApiQuery } from "#/hooks/use-api-query";
import { PageError } from "#/components/page-states";
import { CreditCapacityBar, UsageChart } from "./overview-sections";
import {
  ChannelMessageRail,
  ChannelRail,
  ClippedNote,
  PeopleRail,
  ToolRail,
} from "./overview-rails";
import {
  RecentThreads,
  WaitingOnYou,
  type OpenActivity,
} from "./overview-activity";
import { ActiveAgentBoard } from "./overview-agent-board";

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
 * ones were. **The grid is the spec**: ACTIVITY is a two-up row of cards with
 * the agent board under it; USAGE is the capacity bar beside the chart over two
 * rows of rails. Cards are sized to content and empty ones say so in one line.
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
        <SectionPanel id="home-overview-activity" label="Activity">
          {data ? (
            <div className="flex flex-col gap-3">
              <div className="grid grid-cols-2 gap-3">
                <WaitingOnYou
                  rows={data.attention ?? EMPTY_ATTENTION}
                  onOpen={onOpenActivity}
                />
                <RecentThreads
                  rows={data.threads ?? EMPTY_THREADS}
                  onOpen={onOpenActivity}
                />
              </div>
              {/* ⚠ THE BOARD FOLDS AWAY ENTIRELY WHEN NOTHING IS RUNNING. It
                  renders `null` for an empty lane set, and this guard keeps the
                  heading from standing over it — an empty state must not cost a
                  full-width strip (Samuel). */}
              {agents.length > 0 && (
                // ⚠ A `<section>`, not a `<div>`: the board's heading has to
                // BOUND it, or a query scoped to "Active agents" widens to the
                // whole panel and picks up the cards above.
                <section className="flex flex-col gap-2">
                  <h3 className="px-1 text-label font-semibold uppercase tracking-wide text-text-secondary">
                    Active agents
                  </h3>
                  <ActiveAgentBoard rows={agents} onOpen={onOpenActivity} />
                </section>
              )}
            </div>
          ) : (
            <ActivityGhost />
          )}
        </SectionPanel>

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
          <section className="bento flex flex-col gap-4 p-3.5">
            <CreditsBar homeWorkspaceId={homeWorkspaceId} />
            <CreditsChart />
          </section>
        </SectionPanel>

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
 * The allowance bar, at the top of the Usage panel and across its full width.
 *
 * ⚠ **ITS OWN COMPONENT BECAUSE IT HAS ITS OWN READ** — `GET /api/billing/status`
 * through the SAME hook the settings modal's billing pane uses, so one cache
 * entry serves both and the bar costs no second credits read. Keeping it here
 * means its loading state does not gate the plot under it.
 */
function CreditsBar({ homeWorkspaceId }: { homeWorkspaceId: string | null }) {
  const credits = useWorkspaceEntitlements(homeWorkspaceId ?? undefined);
  // ⚠ A GHOST OF THE BAR'S OWN HEIGHT while the billing read is in flight, and
  // when the caller has no workspace yet — never a zeroed bar, which would claim
  // a spent allowance nobody measured.
  if (credits.loading || !homeWorkspaceId) {
    return <Skeleton className="h-[54px] w-full rounded-lg" />;
  }
  return <CreditCapacityBar credits={credits.credits} />;
}

/**
 * The month histogram.
 *
 * 🔒 **PINNED TO `credits` — THERE IS NO METRIC STATE AND NO SWITCHER**
 * (Samuel: "I explicitly said not to do MCP calls but credits"). The page asks
 * for exactly one series. `HOME_OVERVIEW_DEFAULT_METRIC` is that pin; the ROUTE
 * still validates all three metrics, because it is a general endpoint with its
 * own tests — see the report's flagged item.
 */
function CreditsChart() {
  const series = useApiQuery<HomeOverviewSeries>(
    `/api/home/overview-series?range=${HOME_OVERVIEW_DEFAULT_RANGE}&metric=${HOME_OVERVIEW_DEFAULT_METRIC}`,
    { keepPreviousData: true }
  );
  return (
    <UsageChart
      points={series.data?.points ?? EMPTY_SERIES}
      bucket={series.data?.bucket ?? "day"}
      loading={series.isPending}
      truncated={series.data?.truncated ?? false}
    />
  );
}

/** The Activity panel's first frame — two cards, the shape that resolves. */
function ActivityGhost() {
  return (
    <div className="grid grid-cols-2 gap-3">
      {Array.from({ length: 2 }).map((_, index) => (
        <Skeleton key={index} className="h-[176px] rounded-[14px]" />
      ))}
    </div>
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
