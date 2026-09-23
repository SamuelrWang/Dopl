import { cn } from "@/shared/lib/utils";
import {
  IDENTITY_NAME_TEXT,
} from "@/features/agent-identities/components/identity-section";
import { useState } from "react";
import { SectionPanel } from "@/shared/ui/section-panel";
import { Skeleton } from "@/shared/ui/skeleton";
import { useWorkspaceEntitlements } from "@/features/billing/components/use-workspace-entitlements";
import {
  EMPTY_CHANNEL_USAGE,
  EMPTY_PERSON_USAGE,
  EMPTY_SERIES,
  EMPTY_TOOL_USAGE,
  HOME_OVERVIEW_DEFAULT_METRIC,
  HOME_OVERVIEW_DEFAULT_RANGE,
  type HomeChannelUsage,
  type HomeOverview,
  type HomeOverviewSeries,
} from "@/features/home/overview-types";
import { useApiQuery } from "#/hooks/use-api-query";
import { PageError } from "#/components/page-states";
import { openHomeSettings } from "./home-settings-control";
import { CreditCapacityBar, UsageChart } from "./overview-sections";
import {
  ChannelCreditRail,
  ChannelMessageRail,
  ClippedNote,
  PeopleRail,
  RailsGhost,
  ToolRail,
  type RankRow,
} from "#/components/overview/rank-rail";
import {
  MonthStepper,
  USAGE_SCOPE_ALL,
  UsageScopeMenu,
  monthKey,
  usageSeriesPath,
} from "./overview-usage-filter";
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
 * 🔒 **DENSE PANELS OF BENTO CARDS — NOT A COLUMN OF FULL-WIDTH STRIPS
 * (Samuel, 2026-09-01, live review: "this looks so bad, the other one looked so
 * much better").** The first rebuild gave every section its own full-width
 * `SectionPanel`, so the page became five giant boxes with holes where the empty
 * ones were. **The grid is the spec**: USAGE is the capacity bar over the chart,
 * then Token spend, then two rows of rails. Cards are sized to content and empty
 * ones say so in one line.
 * ⚠ **The panel is the GROUPING, the card is the surface.** A section that
 * wants to be a full-width strip needs a reason that is not "it has a heading".
 *
 * 🔒 **AND THERE IS NO ACTIVITY PANEL ANY MORE (Samuel, 2026-09-20: he saw it
 * in the app and ruled it gone).** The **Active agents** board, its `/home`
 * adapter file, the `onOpenActivity` prop that fed it and the whole server read
 * behind it (`HomeOverview.agents`, `HomeAgentRow`, `mapAgents`, the running-
 * session repository read and its `Promise.all` leg) went in the same change —
 * delete, never disarm. ⚠ **The BOARD ITSELF IS NOT GONE**: it is
 * `#/components/overview/agent-board.tsx`, and the WORKSPACE Overview
 * (`pages/overview/agent-board.tsx`) is its one remaining host. Do not bring a
 * second host back here.
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
}: {
  /**
   * The caller's own workspace from `POST /api/boot`, for the credit bar.
   * ⚠ NULL until the caller is onboarded; the bar says nothing rather than
   * asking about a workspace that does not exist.
   */
  homeWorkspaceId: string | null;
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

  return (
    <div className="min-w-0 flex-1 overflow-y-auto p-3">
      {/* ⚠ **A COLUMN, AND IT OPENS ON USAGE SINCE 2026-09-20.** Activity stood
          above this panel and folded away on its own, so the column has always
          had to read correctly without it — removing it moved no sibling and
          left no hole. ⚠ **AND THERE IS NO ONE-CHILD ROW HIDING IN HERE**: the
          only grids on this face are the rails' own `grid-cols-2` PAIRS, which
          still hold two each. A row left with one child is a row waiting for a
          sibling that is not coming back (the precedent is the workspace
          Overview's own Activity cut, `cb7b4d61`). */}
      <div className="flex flex-col gap-3">
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
            🔒 **TWO CARDS SINCE 2026-09-13, NOT ONE (Samuel: *"I want the
            credits bar and the bar graph to be split into two different white
            panels with some spacing between them"*)** — the bar in its own
            `.bento`, the histogram in a second, `gap-3` between them, and ONE
            well behind both. It was a single card holding the two stacked.
            ⚠ **THE `.bento` IS THE SAME RECIPE THE RAIL CARDS WEAR**
            (`rank-rail.tsx › RailCard`) and the gap is the rails' grid gap,
            so the panels layer and space identically by construction rather than
            by class strings that happen to agree today.
            ⚠ **NOTHING ELSE IN THE PANEL** — the bar card, then the histogram
            card. A rail, a note or a total goes in the panel below. */}
        {/* 🔒 **THE 2026-09-08 WHITE TRIAL IS REVERTED (Samuel, 2026-09-13:
            *"the usage panel doesn't have the gray shadow anymore. I want you to
            restore the gray shadow behind the usage panel. This will be one gray
            shadow right behind this"*).** That trial passed `className=
            "!bg-home-card"` plus a `titleClassName` of its own, which painted the
            panel WHITE and dropped the bar and the plot straight onto it — one
            layer short, and the only section on the face that did not match its
            siblings. **Both overrides are gone — and the `titleClassName` PROP
            went with them** (`shared/ui/section-panel.tsx`: it had no other
            caller), so `SectionPanel`'s own ground (R-38, 2026-09-17) grounds
            this panel exactly as it grounds Token spend and All channels: **ONE
            well, behind the whole Usage block**, with the white cards inside. */}
        {/* Heading type is `SectionPanel`'s own now — the "Usage" trial became
            the rule for every section heading (Samuel, 2026-09-13). */}
        <SectionPanel id="home-overview-usage" label="Usage">
          <UsageCard homeWorkspaceId={homeWorkspaceId} />
        </SectionPanel>

        {/* ⚠ **TOKEN SPEND IS ITS OWN PANEL, NOT A THIRD THING IN THE USAGE
            CARD** (2026-09-06, Samuel #1326). That card is the CREDITS story —
            one billing period, exact counts — and this is a different ledger
            with a different accuracy story (a floor, and a 31-day window rather
            than the credit period). The panel folds itself away when no agent
            has ever spent anything — ⚠ **it is the LAST panel on this face that
            still does that**, now that Activity (which folded on the same
            argument) is deleted. */}
        <TokenSpendPanel />

        {/* The comparison rails — OUTSIDE Usage, same card styling as before.
            ⚠ `?? EMPTY_X` INLINE AT EVERY READ (§8): this payload is IndexedDB-
            persisted, so an entry written by an older bundle can lack a key this
            one `.map`s over — and `.map` on `undefined` THROWS and blanks the
            whole pane. */}
        <SectionPanel id="home-overview-breakdown" label="All channels">
          {data ? (
            <div className="flex flex-col gap-3">
              <div className="grid grid-cols-2 gap-3">
                <ChannelCreditRail
                  rows={channelRows(
                    data.channels ?? EMPTY_CHANNEL_USAGE,
                    (row) => row.credits
                  )}
                />
                <ChannelMessageRail
                  rows={channelRows(
                    data.channels ?? EMPTY_CHANNEL_USAGE,
                    (row) => row.messages
                  )}
                />
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
 * THE USAGE BLOCK — the capacity-bar card over the histogram card, ONE read
 * behind both.
 *
 * 🔒 **TWO CARDS IN ONE WELL, AND THE CONTROLS BELONG TO THE LOWER ONE
 * (Samuel, 2026-09-13).** The scope dropdown and the month arrows change THIS
 * component's read path, which is why the state sits here and not in the chart:
 * `overview-usage-filter.tsx › usageSeriesPath` turns the pair into the query,
 * and a default selection sends neither param so the common path is unchanged.
 * ⚠ **THE CAPACITY BAR IS DELIBERATELY OUTSIDE THAT** — it reads
 * `/api/billing/status`, the wallet's CURRENT period, and no control on this face
 * moves it.
 *
 * 🔒 **THE BAR AND THE PLOT AGREE BY ANSWERING THE SAME QUESTION, NOT BY SHARING
 * AN ARRAY (Samuel, 2026-09-12: "is the credits usage wired in? I want to make
 * sure").** Ruling #10 (2026-09-06) made the bar print `seriesTotal(points)` so
 * the two halves of this card could not differ — and they could not, while both
 * were wrong together: the series summed the ledger across EVERY container the
 * reader had burned in, so the bar said `416 of 500` beside a Settings pane
 * reading `0 of 500` off the wallet, with 56 more credits of the same period
 * sitting on a SEAT wallet in a standard workspace. **The bar reads the WALLET
 * now** — `credits.credits.used`, the same `/api/billing/status` field Settings
 * prints — and the SERVER narrowed the credits series to that same wallet's
 * ledger rows (`service-overview.ts › scanPersonalWalletBurns`), so the plot
 * totals the bar again for the right reason.
 * ⚠ **THE SERIES IS STILL FETCHED HERE RATHER THAN IN THE CHART**, and it is
 * still ONE read: the bar gates on it (see `CreditsBar`) so the card arrives
 * whole instead of the bar popping in over a skeleton plot.
 *
 * 🔒 **PINNED TO `credits` — THERE IS NO METRIC STATE AND NO SWITCHER**
 * (Samuel: "I explicitly said not to do MCP calls but credits"). The page asks
 * for exactly one series. `HOME_OVERVIEW_DEFAULT_METRIC` is that pin; the ROUTE
 * still validates all three metrics, because it is a general endpoint with its
 * own tests.
 */
function UsageCard({ homeWorkspaceId }: { homeWorkspaceId: string | null }) {
  // ⚠ **SESSION STATE, NOT PERSISTED** — the pane opens on All channels and the
  // current month every time (`overview-usage-filter.tsx` carries why).
  const [scope, setScope] = useState<string>(USAGE_SCOPE_ALL);
  const [month, setMonth] = useState<string>(() => monthKey());
  const series = useApiQuery<HomeOverviewSeries>(
    usageSeriesPath({
      range: HOME_OVERVIEW_DEFAULT_RANGE,
      metric: HOME_OVERVIEW_DEFAULT_METRIC,
      scope,
      month,
    }),
    { keepPreviousData: true }
  );
  // ⚠ `?? EMPTY_SERIES` INLINE (§8): an IndexedDB-persisted entry written by an
  // older bundle can lack `points`, and the reduce below would throw on it.
  const points = series.data?.points ?? EMPTY_SERIES;
  return (
    <div className="flex flex-col gap-3">
      {/* ⚠ **THE `.bento` RECIPE AND THE `gap-3`, BOTH BY MATCH AND NOT BY
          TASTE**: the card is what `rank-rail.tsx › RailCard` and
          `overview-token-spend.tsx › TokenSpendPanel` wear, and the gap is the
          one the 2×2 rail grid uses — so the three panels on this face layer and
          space identically by construction. */}
      <section className="bento p-3.5" aria-label="Credit allowance">
        {/* 🔒 **THE CARD SAYS WHAT IT IS (Samuel, 2026-09-13: *"in the panel
            above … the credit bar, put in a header that says 'Credit
            spend'"*).** Minimal copy (INVARIANTS §5): two words, no subline.
            ⚠ **`IDENTITY_NAME_TEXT`, THE 14px FACE — NOT THE PANEL HEADING'S
            `_LG`** (Samuel, same day, rejecting a pass that raised it: *"You
            changed the font size of the credit spend, all channels, and the date
            to the super large size, like usage. I did not ask for that"*). This
            heading, the scope menu and the month label are ONE size and the
            panel's **Usage** is the step above them.
            ⚠ **IT IS THE CARD'S, NOT `CreditCapacityBar`'s**, for the same
            reason the `.bento` frame is: that component owns the BAR and states
            it paints no card. It also has to outlive the bar's skeleton — a
            heading rendered inside the loaded bar would arrive after it and the
            card would say nothing while it waits.
            ⚠ An `h3`: the panel's `h2` is **Usage**. */}
        <h3 className={cn("mb-2 truncate", IDENTITY_NAME_TEXT)}>Credit spend</h3>
        <CreditsBar
          homeWorkspaceId={homeWorkspaceId}
          ledgerPending={series.isPending && !series.data}
        />
      </section>
      <section className="bento flex flex-col p-3.5" aria-label="Usage histogram">
        <UsageChart
          points={points}
          bucket={series.data?.bucket ?? "day"}
          loading={series.isPending}
          truncated={series.data?.truncated ?? false}
          scopeControl={<UsageScopeMenu value={scope} onChange={setScope} />}
          monthControl={<MonthStepper month={month} onChange={setMonth} />}
        />
      </section>
    </div>
  );
}

/**
 * The allowance bar, at the top of the Usage panel and across its full width.
 *
 * ⚠ **ITS OWN COMPONENT BECAUSE IT HAS ITS OWN READ** — `GET /api/billing/status`
 * through the SAME hook the settings modal's billing pane uses, so one cache
 * entry serves both and the bar costs no second credits read.
 *
 * 🔒 **BOTH NUMBERS ON THIS BAR COME OFF THAT ONE READ (Samuel, 2026-09-12).**
 * `spent` is `credits.credits.used` — **the wallet counter itself**, the field
 * Settings › Plans & billing prints — and NOT `seriesTotal(points)`, which is
 * what it was between 2026-09-06 and this change and what made the two surfaces
 * disagree: the series summed the ledger over every container the reader had
 * burned in, personal wallet and other people's seat wallets alike. The wallet is
 * the only thing that can answer *how much of MY allowance is gone*, because the
 * wallet is what enforcement charged. The plot below re-derives the same figure
 * from the same wallet's ledger rows, server-side.
 * ⚠ **THE DEGRADED READING IS UNCHANGED, AND IT IS THE LIMIT THAT HAS THE
 * FALLBACK, NOT THE SPEND** (`overview-sections.tsx › CreditCapacityBar`): a
 * payer that never resolved answers `used: 0, limit: 0, degraded: true`, so the
 * denominator falls back to `PERSONAL_MONTHLY_CREDITS.free` and the numerator
 * stays the measured 0 — which is now the SAME zero Settings shows, rather than a
 * ledger sum contradicting it.
 */
function CreditsBar({
  homeWorkspaceId,
  ledgerPending,
}: {
  homeWorkspaceId: string | null;
  /** The ledger read has not landed AND there is no previous series to stand
   *  in — see the ghost below. ⚠ **STILL A GATE THOUGH THE BAR NO LONGER READS
   *  THE LEDGER**: the bar and the plot are one card, and a bar that renders
   *  ahead of the plot it sits on top of arrives as a half-drawn card. */
  ledgerPending: boolean;
}) {
  const credits = useWorkspaceEntitlements(homeWorkspaceId ?? undefined);
  // ⚠ A GHOST OF THE BAR'S OWN HEIGHT while either read is in flight, and when
  // the caller has no workspace yet — never a zeroed bar, which would claim a
  // spent allowance nobody measured. ⚠ THE LEDGER READ IS STILL ONE OF THOSE
  // GATES even though the spend no longer comes from it (2026-09-12): the bar and
  // the plot are one card and should appear together. A KEPT previous series is
  // not pending by this test, so a refetch never re-ghosts a bar that already has
  // a figure — the same trade the plot makes when it dims instead of blanking.
  if (credits.loading || !homeWorkspaceId || ledgerPending) {
    return <Skeleton className="h-[54px] w-full rounded-lg" />;
  }
  // ⚠ THE PLAN NO LONGER RIDES ALONG (2026-09-07). It stood in for a `limit: 0`
  // reading, but /home spends the reader's PERSONAL wallet, whose allowance is
  // one constant and no plan's — `overview-sections.tsx › CreditCapacityBar`
  // reads `credits.ts › PERSONAL_MONTHLY_CREDITS` itself.
  // ⚠ **`!isPaid`, NOT `plan === "free"` (2026-09-08).** The question the button
  // answers is *is there something to buy*, and `isPaid` is the only field that
  // answers it from the payload ALONE: it reads the plan and the STATUS
  // together, so a cached or hand-built row whose plan still says `pro` while
  // its status does not say active/past_due is offered the upgrade rather than
  // silently denied it. A `past_due` payer has `isPaid` true and gets no button
  // — they need the portal, not a second checkout. Same rule the plan cards use
  // for their Free arm (`plan-cards.tsx › isCurrentPlan`).
  return (
    <CreditCapacityBar
      credits={credits.credits}
      spent={credits.credits.used}
      onUpgrade={
        credits.isPaid ? undefined : () => openHomeSettings("billing")
      }
    />
  );
}

/** ⚠ **THE ID KEY IS THIS PAGE'S** — /home addresses a channel by
 *  `workspaceId`, a workspace by `channelId`, which is why the shared rail takes
 *  `RankRow`s and not a key flag. */
function channelRows(
  rows: readonly HomeChannelUsage[],
  value: (row: HomeChannelUsage) => number
): RankRow[] {
  return rows.map((row) => ({
    id: row.workspaceId,
    name: row.name,
    value: value(row),
  }));
}
