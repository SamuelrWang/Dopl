import type { BridgeResponse } from "#/lib/dopl-bridge";
import { USER_ID, ok } from "#/test-utils/bridge";
import type {
  HomeOverview,
  HomeOverviewSeries,
} from "@/features/home/overview-types";
import { LINK_WORKSPACE_ID } from "./home-test-ids";

/**
 * THE OVERVIEW FACE'S FIXTURES AND ITS THREE READS.
 *
 * ⚠ SPLIT OUT OF `home-test-harness.tsx` ON 2026-09-01, and for the reason that
 * file was itself split out of `index.test.tsx`: it was AT the 500-line cap
 * (§1 — `eslint.config.mjs › max-lines`, an error over `apps/*​/src/**`), so it
 * could not absorb a fourth face's fixtures. The harness re-exports everything
 * here, so `import { HOME_OVERVIEW } from "./home-test-harness"` keeps working
 * and no suite moved.
 *
 * 🔒 **THERE IS NO SCOPED FIXTURE ANY MORE, AND ITS ABSENCE IS AN ASSERTION.**
 * `HOME_OVERVIEW_SCOPED` existed to answer `?workspaceId=`, which is the param
 * that made the face render every section twice for an operator with one home
 * channel — the duplication Samuel reported. The param is gone; a fixture for it
 * would be a fixture for a request the client can no longer make.
 *
 * ⚠ A `.ts` FILE, NOT `.tsx`, DELIBERATELY. Nothing here renders, and the
 * /home no-concave sweep (`template-editor.test.tsx › no concave surfaces`)
 * enumerates every non-test `.tsx` in this directory — a JSX-free fixture
 * module has no surface to get wrong and does not belong in that list.
 */

/** A second container, so the by-channel rails and the agent BOARD have more
 *  than one lane to sort and group. */
export const SECOND_WORKSPACE_ID = "ws-link-2";

/**
 * The account-wide payload the Overview tab opens on (2026-09-01).
 *
 * ⚠ TYPED, so a renamed field on the wire breaks this fixture at COMPILE time
 * rather than leaving a green suite asserting against a payload the endpoint
 * stopped sending.
 */
export const HOME_OVERVIEW: HomeOverview = {
  range: "month",
  since: "2026-09-01T00:00:00.000Z",
  // ⚠ CREDITS, not MCP calls, since 2026-09-01 — the rails read the
  // `credit_usage_events` ledger now (F-328's UI half).
  channels: [
    {
      workspaceId: LINK_WORKSPACE_ID,
      name: "Priya Shah",
      credits: 464,
      messages: 120,
    },
    {
      workspaceId: SECOND_WORKSPACE_ID,
      name: "Q3 Fundraise",
      credits: 12,
      messages: 4,
    },
  ],
  // ⚠ ONE GUEST AND ONE OWNER — the split Samuel asked this face for, and the
  // one thing `workspace_members` can answer that `channel_members` cannot.
  people: [
    { userId: USER_ID, name: "Sam Wang", role: "owner", credits: 464 },
    { userId: "user-2", name: "Priya Shah", role: "guest", credits: 12 },
  ],
  tools: [
    { tool: "channel", op: "list", calls: 319 },
    { tool: "kb", op: "read_file", calls: 52 },
  ],
  /**
   * ⚠ THREE SESSIONS ACROSS **TWO** CHANNELS, on purpose: the board groups by
   * channel, so a fixture confined to one container could not tell a board from
   * a list. ⚠ One is a PEER's and one is a channel-level launch (no `threadId`),
   * which are the two degradations the card has to render.
   */
  agents: [
    {
      id: "sess-1",
      workspaceId: LINK_WORKSPACE_ID,
      channelName: "Priya Shah",
      name: "flint",
      state: "working",
      detail: "thinking",
      threadId: "task-1",
      threadTitle: "Q3 renewals",
      mine: true,
      updatedAt: "2026-09-01T10:05:00.000Z",
    },
    {
      id: "sess-2",
      workspaceId: LINK_WORKSPACE_ID,
      channelName: "Priya Shah",
      name: "scout",
      state: "idle",
      detail: null,
      threadId: null,
      threadTitle: null,
      mine: false,
      updatedAt: "2026-09-01T09:00:00.000Z",
    },
    {
      id: "sess-3",
      workspaceId: SECOND_WORKSPACE_ID,
      channelName: "Q3 Fundraise",
      name: "quill",
      state: "working",
      detail: "tool",
      threadId: "task-9",
      threadTitle: "Deck review",
      mine: true,
      updatedAt: "2026-09-01T08:40:00.000Z",
    },
  ],
  scanned: 476,
  truncated: false,
};

export const HOME_SERIES: HomeOverviewSeries = {
  range: "month",
  metric: "credits",
  bucket: "day",
  points: Array.from({ length: 7 }, (_, i) => ({
    at: `2026-09-0${i + 1}T00:00:00.000Z`,
    count: i * 10,
  })),
  truncated: false,
};

/**
 * The credit bar's read — the SAME endpoint the settings modal's billing pane
 * uses, so one cache entry serves both in the app.
 *
 * ⚠ **`credits.used` (320) IS DELIBERATELY NOT `HOME_SERIES`'s SUM (210).** The
 * bar's spent figure comes from the LEDGER now (ruling #10, 2026-09-06), and two
 * fixtures that happened to agree would let the payer's counter creep back onto
 * that card without a single test turning red.
 *
 * ⚠ EXPORTED so a case can degrade ONE field of it — a suite hand-rolling a
 * whole status body is a second fixture that stops matching the endpoint.
 */
export const BILLING_STATUS = {
  plan: "free",
  status: "free",
  memberCount: 1,
  seatCount: null,
  objectCap: null,
  objectsUsed: 0,
  canCreateObjects: true,
  chatsWindowDays: 90,
  credits: {
    used: 320,
    limit: 500,
    remaining: 180,
    periodStart: "2026-09-01T00:00:00.000Z",
    periodEnd: "2026-10-01T00:00:00.000Z",
  },
  cancelAtPeriodEnd: false,
  subscription_period_end: null,
  has_stripe_customer: false,
};

/**
 * The Overview face's three reads.
 *
 * ⚠ **ONE BODY FOR `/api/home/overview`, WHATEVER THE QUERY.** There is no
 * scoped variant to answer — see this file's header.
 */
export function overviewRoutes(path: string): Promise<BridgeResponse> | null {
  const [bare, query = ""] = path.split("?");
  if (bare === "/api/home/overview") {
    return Promise.resolve(ok(HOME_OVERVIEW));
  }
  if (bare === "/api/home/overview-series") {
    const metric = query.includes("metric=messages")
      ? "messages"
      : query.includes("metric=mcp")
        ? "mcp"
        : "credits";
    return Promise.resolve(ok({ ...HOME_SERIES, metric }));
  }
  if (bare === "/api/billing/status") {
    return Promise.resolve(ok(BILLING_STATUS));
  }
  return null;
}
