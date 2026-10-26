// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { PERSONAL_MONTHLY_CREDITS } from "@/features/billing/credits";
import {
  USAGE_SCOPE_ALL,
  USAGE_SCOPE_DESKTOP,
  type HomeOverviewSeries,
} from "@/features/home/overview-types";
import type { TokenSpendReport } from "@/shared/lib/token-spend-days";
import { monthKey, monthLabel, shiftMonthKey } from "@/features/home/overview-period";
import { HomeOverview } from "./home-overview";
import type { HomeOverviewReadArgs, HomeOverviewReads } from "./use-home-overview-reads";
import { CREDITS, HOME_CHANNELS, SERIES, read, reads, spendToday } from "./overview-test-fixtures";

afterEach(cleanup);

function mount(state: Partial<HomeOverviewReads> = {}) {
  const calls: HomeOverviewReadArgs[] = [];
  const onOpenSettings = vi.fn();
  render(
    <HomeOverview
      homeWorkspaceId="ws-home"
      homeChannels={HOME_CHANNELS}
      onOpenSettings={onOpenSettings}
      onOpenChannel={vi.fn()}
      onOpenMessage={vi.fn()}
      onOpenTask={vi.fn()}
      useReads={(args) => {
        calls.push(args);
        return reads(state);
      }}
    />
  );
  return { calls, onOpenSettings, credits: screen.getByRole("region", { name: "Credits" }) };
}

const wallet = (credits: Partial<typeof CREDITS>, isPaid = false) => ({
  wallet: { loading: false, credits: { ...CREDITS, ...credits }, isPaid },
});

describe("the Credits card", () => {
  it("prints the wallet counter, what is left and the reset, while the plot totals its own bars", () => {
    const { credits } = mount();
    expect(within(credits).getByText("320")).toBeTruthy();
    expect(within(credits).getByText("of 500 used")).toBeTruthy();
    expect(within(credits).getByText("180 left")).toBeTruthy();
    expect(within(credits).getByText(/^Resets /)).toBeTruthy();
    expect(within(credits).getByText("210")).toBeTruthy();
    const bars = within(credits).getByRole("list", { name: /^Daily credits/ });
    expect(within(bars).getAllByRole("listitem")).toHaveLength(SERIES.points.length);
    const third = within(bars).getByRole("listitem", { name: "Sep 3 · 20 credits" });
    expect(third.getAttribute("title")).toBe("Sep 3 · 20 credits");
  });

  it("dims the previous key's bars while the next scope or month lands", () => {
    mount({ series: read(SERIES, { isPlaceholderData: true }) });
    expect(screen.getByRole("list", { name: /^Daily credits/ }).getAttribute("data-dim")).toBe("true");
    cleanup();
    mount();
    expect(screen.getByRole("list", { name: /^Daily credits/ }).getAttribute("data-dim")).toBeNull();
  });

  it("draws a full month of zero bars, not an empty state", () => {
    const zeros = { ...SERIES, points: SERIES.points.map((point) => ({ ...point, count: 0 })) };
    mount({ series: read(zeros) });
    const bars = screen.getByRole("list", { name: /^Daily credits/ });
    expect(within(bars).getAllByRole("listitem")).toHaveLength(SERIES.points.length);
    expect(screen.queryByText("No credits spent")).toBeNull();
  });

  it("reads a persisted series with no points as no bars", () => {
    mount({ series: read({ ...SERIES, points: undefined } as never) });
    expect(screen.getByText("No credits spent")).toBeTruthy();
  });

  it("says nothing when the wallet and the ledger agree", () => {
    const { credits } = mount();
    expect(within(credits).queryByText("Unreconciled")).toBeNull();
    expect(within(credits).queryByText("Unmetered")).toBeNull();
  });

  it("tracks credits.used when only the wallet changes", () => {
    const { credits } = mount(wallet({ used: 400, remaining: 100 }));
    expect(within(credits).getByText("400")).toBeTruthy();
    expect(within(credits).getByText("100 left")).toBeTruthy();
    expect(within(credits).getByText("210")).toBeTruthy();
  });

  it("falls back to the personal free allowance when the payer never resolved", () => {
    const { credits } = mount(wallet({ limit: 0, remaining: 0, used: 40, periodEnd: "" }));
    expect(within(credits).getByText(`of ${PERSONAL_MONTHLY_CREDITS.free} used`)).toBeTruthy();
    expect(within(credits).queryByText(/^Resets /)).toBeNull();
    expect(within(credits).queryByText(/paused/)).toBeNull();
  });

  it("says Unreconciled and Unmetered in one word each, never the figure or the instant", () => {
    const { credits } = mount(wallet({ ledgerDrift: -37, unmeteredSince: "2026-09-14T08:00:00.000Z" }));
    expect(within(credits).getByText("Unreconciled")).toBeTruthy();
    expect(within(credits).getByText("Unmetered")).toBeTruthy();
    expect(credits.textContent).not.toContain("37");
    expect(credits.textContent).not.toContain("08:00");
  });

  it("offers Get more credits to an unpaid wallet only", () => {
    const { onOpenSettings, credits } = mount();
    fireEvent.click(within(credits).getByRole("button", { name: "Get more credits" }));
    expect(onOpenSettings).toHaveBeenCalledWith("billing");
    cleanup();
    const paid = mount(wallet({}, true));
    expect(within(paid.credits).queryByRole("button", { name: "Get more credits" })).toBeNull();
  });

  it("says when the period is spent", () => {
    const { credits } = mount(wallet({ used: 500, remaining: 0 }));
    expect(within(credits).getByText("Tool calls are paused until the next period.")).toBeTruthy();
  });

  it("says a clipped series is a floor, and a failed one failed", () => {
    mount({ series: read({ ...SERIES, truncated: true }) });
    expect(screen.getByText("Newest rows only.")).toBeTruthy();
    cleanup();
    mount({ series: read<HomeOverviewSeries>(undefined, { error: new Error("x") }) });
    expect(screen.getByText("Couldn't load daily credits.")).toBeTruthy();
  });

  it("scopes to All channels, Desktop agent, then each home channel by its own id", () => {
    const { calls } = mount();
    expect(calls.at(-1)?.scope).toBe(USAGE_SCOPE_ALL);
    fireEvent.click(screen.getByRole("button", { name: "Usage scope" }));
    const labels = screen.getAllByRole("menuitem").map((item) => item.textContent ?? "");
    expect(labels.map((label) => label.split("Credits burned")[0])).toEqual([
      "All channels",
      "Desktop agent",
      "Priya Shah",
    ]);
    fireEvent.click(screen.getByRole("menuitem", { name: /Desktop agent/ }));
    expect(calls.at(-1)?.scope).toBe(USAGE_SCOPE_DESKTOP);
  });

  it("steps the month back and forward, never past the current one", () => {
    const { calls } = mount();
    const next = screen.getByRole("button", { name: "Next month" });
    expect((next as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Previous month" }));
    expect(calls.at(-1)?.month).toBe(shiftMonthKey(monthKey(), -1));
    expect(screen.getByText(monthLabel(shiftMonthKey(monthKey(), -1)))).toBeTruthy();
    fireEvent.click(next);
    expect(calls.at(-1)?.month).toBe(monthKey());
  });
});

describe("the Tokens card", () => {
  it("prints a floor", () => {
    mount({ spend: read(spendToday([1_260_000, 9_999])) });
    const tokens = screen.getByRole("region", { name: "Tokens" });
    expect(within(tokens).getByText("At least 1.2M")).toBeTruthy();
    expect(within(tokens).getByText("2 sessions")).toBeTruthy();
  });

  it("labels each day, and reads a persisted report with no marks as empty", () => {
    mount({ spend: read(spendToday([1_260_000])) });
    const days = screen.getByRole("list", { name: /^Tokens per day/ });
    expect(within(days).getAllByRole("listitem")).toHaveLength(31);
    expect(within(days).getAllByRole("listitem").at(-1)?.getAttribute("title")).toMatch(/ · 1\.2M tokens$/);
    cleanup();
    mount({ spend: read({ truncated: false } as never) });
    expect(screen.getByText("No agent has spent tokens")).toBeTruthy();
  });

  it("tells empty from failed", () => {
    mount({ spend: read(spendToday([])) });
    expect(screen.getByText("No agent has spent tokens")).toBeTruthy();
    cleanup();
    mount({ spend: read<TokenSpendReport>(undefined, { error: new Error("x") }) });
    expect(screen.getByText("Couldn't load token spend.")).toBeTruthy();
  });
});
