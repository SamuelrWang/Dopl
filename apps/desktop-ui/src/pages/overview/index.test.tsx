import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createQueryClient } from "#/lib/query-client";
import type { TransportRequest } from "#/lib/api-transport";
import { SEGMENT, WORKSPACE_ID, bootBody, installBridge } from "#/test-utils/bridge";
import type {
  OverviewSeriesMetric,
  WorkspaceOverview,
} from "@/features/workspaces/types";
import OverviewPage from "./index";
import { greetingFor } from "./overview-header";

/**
 * The overview page is WIRED: boot → `overview` + `overview-series` + the
 * shared billing read. Mocked at the bridge like every other page suite, so the
 * SPA transport and the reused WEB billing client (`useWorkspaceEntitlements`)
 * funnel through one stub — the packaged topology.
 */

const sendRequest = vi.hoisted(() => vi.fn());
vi.mock("#/lib/api-transport", () => ({ sendRequest }));

const transportCalls = () =>
  sendRequest.mock.calls.map((args) => (args as unknown[])[0] as TransportRequest);

const OVERVIEW_PATH = `/api/workspaces/${SEGMENT}/overview`;
const SERIES_PATH = `/api/workspaces/${SEGMENT}/overview-series`;

const OVERVIEW: WorkspaceOverview = {
  counts: { messagesToday: 10, agentsRunning: 3, members: 13, channels: 7 },
  activity: [
    {
      id: "a-1",
      channelId: "c-1",
      channelName: "general",
      kind: "message",
      actorName: "Samuel Wang",
      preview: "Shipping the overview wiring",
      at: "2026-08-22T09:05:00.000Z",
    },
    {
      id: "a-2",
      channelId: "c-2",
      channelName: "research",
      kind: "thread_opened",
      actorName: "Research agent",
      preview: "Competitor sweep",
      at: "2026-08-22T08:40:00.000Z",
    },
    {
      id: "a-3",
      channelId: "c-2",
      channelName: "research",
      kind: "thread_closed",
      actorName: null,
      preview: "Pricing teardown",
      at: "2026-08-21T17:10:00.000Z",
    },
  ],
  memberLoad: {
    totalMessages: 735,
    rows: [
      { userId: "u-1", name: "Samuel Wang", percent: 82 },
      { userId: "u-2", name: "Dara Whitfield", percent: 18 },
    ],
  },
};

/** Peak differs per metric so a switch is visible in the rendered total. */
const PEAK: Record<OverviewSeriesMetric, number> = {
  messages: 100,
  mcp: 10,
  threads: 1,
};

/** The contract's shape: exactly 31 points, oldest first, zero-filled. */
function seriesDays(metric: OverviewSeriesMetric, allZero = false) {
  return Array.from({ length: 31 }, (_, index) => ({
    date: `2026-07-${String(index + 1).padStart(2, "0")}`,
    count: allZero ? 0 : PEAK[metric] * (index + 1),
  }));
}

const CREDITS = {
  plan: "solo",
  status: "active",
  memberCount: 1,
  seatCount: 1,
  objectCap: null,
  objectsUsed: 0,
  canCreateObjects: true,
  chatsWindowDays: null,
  credits: {
    used: 12480,
    limit: 50000,
    remaining: 37520,
    periodStart: "2026-08-01T00:00:00.000Z",
    periodEnd: "2026-09-01T00:00:00.000Z",
  },
  cancelAtPeriodEnd: false,
  subscription_period_end: null,
  has_stripe_customer: true,
};

function ok(body: unknown) {
  return { status: 200, statusText: "OK", hasBody: true, body };
}

/** The metric a series request asked for; the query rides the path. */
function metricOf(path: string): OverviewSeriesMetric {
  const query = new URLSearchParams(path.split("?")[1] ?? "");
  return (query.get("metric") ?? "messages") as OverviewSeriesMetric;
}

function transport(req: TransportRequest, allZero = false) {
  const path = req.path.split("?")[0];
  if (path === "/api/boot") return Promise.resolve(ok(bootBody()));
  if (path === "/api/billing/status") return Promise.resolve(ok(CREDITS));
  if (path === OVERVIEW_PATH) return Promise.resolve(ok(OVERVIEW));
  // ⚠ The "Needs you" read is NOT in this page's paint gate (it is out-of-band,
  // and the least important read must not be the slowest), so an empty answer is
  // a legitimate first frame — served rather than rejected so the render leaves
  // no rejected promise behind. `needs-you.test.tsx` owns the panel's own cases.
  if (path === "/api/channels/account/status") {
    return Promise.resolve(
      ok({
        channels: [],
        operatorOnline: false,
        since: null,
        truncated: { channels: false, unread: false, waiting: false },
      })
    );
  }
  if (path === SERIES_PATH) {
    const metric = metricOf(req.path);
    return Promise.resolve(ok({ metric, days: seriesDays(metric, allZero) }));
  }
  return Promise.reject(new Error(`unexpected request: ${req.method} ${req.path}`));
}

function renderPage() {
  const router = createMemoryRouter(
    [
      { path: "/:workspaceSegment/overview", element: <OverviewPage /> },
      { path: "/:workspaceSegment/members", element: <p>Members page</p> },
    ],
    { initialEntries: [`/${SEGMENT}/overview`] }
  );
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}

const seriesRequests = () =>
  transportCalls().filter((req) => req.path.startsWith(SERIES_PATH));

describe("overview page", () => {
  beforeEach(() => {
    // ⚠ `restoreMocks` resets implementations, NOT the recorded calls of a
    // hoisted `vi.fn()` — and this suite counts requests.
    sendRequest.mockClear();
    installBridge({
      apiRequest: (path: string, opts: Record<string, unknown> = {}) =>
        sendRequest({ path, ...opts }),
      getAuthState: () => Promise.resolve({ signedIn: false, userId: null }),
      onAuthState: () => () => {},
      openExternal: () => Promise.resolve({ ok: true }),
    });
    sendRequest.mockImplementation((req: TransportRequest) => transport(req));
  });

  // ⚠ The FIRST frame is the skeleton, never a stat row of zeroes that jumps
  // when the payload lands (the filed defect this wiring closes).
  it("shows the page skeleton before any figure", () => {
    const { container } = renderPage();

    expect(screen.getByRole("status")).toHaveTextContent("Loading overview");
    expect(screen.queryByText("Messages today")).not.toBeInTheDocument();
    expect(screen.queryByText("00")).not.toBeInTheDocument();

    // ⚠ AND IT IS THIS PAGE'S SHAPE, module for module (`./overview-skeleton.tsx`).
    // The shared ghost painted a 52px top bar over a THREE-up card row; the
    // page is a `max-w-5xl` column with four stat cards and the uneven 48/52
    // bottom row, so a stat tile landed in a different place than its ghost.
    expect(container.querySelector(".max-w-5xl")).not.toBeNull();
    expect(container.querySelector(".grid-cols-4")).not.toBeNull();
    expect(container.querySelector(".grid-cols-\\[48fr_52fr\\]")).not.toBeNull();
  });

  it("renders the header, the five sections and every live figure", async () => {
    renderPage();

    expect(
      await screen.findByRole("heading", { level: 1, name: "Here is Acme" })
    ).toBeInTheDocument();
    expect(
      screen.getByText(greetingFor(new Date().getHours()))
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Invite members" })
    ).toBeInTheDocument();
    // Inert clone controls are DELETED, not disabled.
    expect(screen.queryByRole("button", { name: "Analytics" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /options$/ })).not.toBeInTheDocument();

    expect(
      screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)
    ).toEqual([
      "This billing period",
      "Messages per day",
      // ⚠ JOINED 2026-09-01 — the ping inbox then, what is ADDRESSED TO YOU AND
      // UNANSWERED since slice B16, and it sits ABOVE the bottom row
      // deliberately: it is the only section on this page that is waiting on the
      // reader, so a position below the fold would reproduce the unread-card
      // failure it was built to fix.
      "Needs you",
      "Recent activity",
      "Member load, last 30 days",
    ]);

    // Counts: single digits zero-padded, the rest grouped.
    expect(screen.getByText("10")).toBeInTheDocument();
    expect(screen.getByText("03")).toBeInTheDocument();
    expect(screen.getByText("13")).toBeInTheDocument();
    expect(screen.getByText("07")).toBeInTheDocument();
    expect(screen.getByText("Live agent sessions")).toBeInTheDocument();

    // Credits, from the SAME hook the settings billing pane reads.
    expect(screen.getByText("12,480")).toBeInTheDocument();
    expect(screen.getByText("37,520")).toBeInTheDocument();
    expect(screen.getByText("of 50,000 allowed")).toBeInTheDocument();

    expect(screen.getByText("Shipping the overview wiring")).toBeInTheDocument();
    expect(screen.getByText("Thread opened")).toBeInTheDocument();
    expect(screen.getByText("Thread closed")).toBeInTheDocument();
    expect(
      screen.getByText("Share of 735 messages, last 30 days")
    ).toBeInTheDocument();

    // Bars carry the real date and count; the axis ceiling is a round number
    // above the peak (3100 → 4000, four uniform bands).
    expect(screen.getByTitle("1/7 · 100")).toBeInTheDocument();
    expect(screen.getByTitle("31/7 · 3,100")).toBeInTheDocument();
    expect(screen.getByText("49,600 in the period")).toBeInTheDocument();
    expect(screen.getByText("4,000")).toBeInTheDocument();
    expect(screen.getByText("2,000")).toBeInTheDocument();
  });

  it("scopes every read to the resolved workspace", async () => {
    renderPage();
    await screen.findByRole("heading", { level: 1 });

    const paths = transportCalls().map((req) => req.path.split("?")[0]);
    expect(paths).toContain("/api/boot");
    expect(paths).toContain(OVERVIEW_PATH);
    expect(paths).toContain(SERIES_PATH);
    expect(paths).toContain("/api/billing/status");

    for (const path of [OVERVIEW_PATH, SERIES_PATH, "/api/billing/status"]) {
      const call = transportCalls().find((req) => req.path.split("?")[0] === path);
      expect(call?.workspaceId).toBe(WORKSPACE_ID);
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it("the metric switcher re-asks for the chosen series only", async () => {
    renderPage();
    await screen.findByRole("heading", { level: 2, name: "Messages per day" });
    expect(seriesRequests()).toHaveLength(1);
    expect(metricOf(seriesRequests()[0].path)).toBe("messages");

    fireEvent.click(screen.getByRole("tab", { name: "MCP calls" }));

    await waitFor(() => expect(seriesRequests()).toHaveLength(2));
    expect(metricOf(seriesRequests()[1].path)).toBe("mcp");
    expect(
      await screen.findByRole("heading", { level: 2, name: "MCP calls per day" })
    ).toBeInTheDocument();
    // Only the series moved — the payload and credits reads are untouched.
    expect(
      transportCalls().filter((req) => req.path === OVERVIEW_PATH)
    ).toHaveLength(1);
  });

  it("plots an all-zero series as a flat baseline, with no NaN heights", async () => {
    sendRequest.mockImplementation((req: TransportRequest) => transport(req, true));
    renderPage();
    await screen.findByRole("heading", { level: 1 });

    expect(screen.getByText("0 in the period")).toBeInTheDocument();
    // Empty workspace ⇒ the fallback 0–4 axis, still uniform.
    expect(screen.getByText("4")).toBeInTheDocument();
    expect(screen.getByTitle("31/7 · 0")).toBeInTheDocument();

    const bars = screen.getAllByTitle(/·/);
    expect(bars).toHaveLength(31);
    for (const bar of bars) expect(bar.style.height).toBe("0%");
  });

  it("routes the header action to the members page", async () => {
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Invite members" }));

    expect(await screen.findByText("Members page")).toBeInTheDocument();
  });

  it("surfaces a failed overview read as the shared page error", async () => {
    sendRequest.mockImplementation((req: TransportRequest) =>
      req.path.split("?")[0] === OVERVIEW_PATH
        ? Promise.resolve({
            status: 404,
            statusText: "Not Found",
            hasBody: true,
            body: { error: { code: "NOT_FOUND", message: "Overview blew up" } },
          })
        : transport(req)
    );

    renderPage();

    expect(await screen.findByRole("alert")).toHaveTextContent("Overview blew up");
  });
});
