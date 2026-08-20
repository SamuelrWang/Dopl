import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import OverviewPage from "./index";
import {
  CHART_BARS,
  MEMBER_LOAD_ROWS,
  PERIOD_STATS,
  STAT_CARDS,
  UPCOMING_ROWS,
} from "./overview-data";

/**
 * The page is STATIC — no transport, no router, no query client. So this is a
 * structure test: every section is present and every row of `overview-data.ts`
 * reaches the DOM. It asserts SETS and LENGTHS, not representative members —
 * the old suite checked one stat card and missed a card being deleted
 * (ENGINEERING.md, overview stat row).
 */

describe("overview page", () => {
  it("renders the header, both actions and the six sections", () => {
    render(<OverviewPage />);

    expect(
      screen.getByRole("heading", { level: 1, name: "Samuel, here is the workspace" })
    ).toBeInTheDocument();
    expect(screen.getByText("Good evening")).toBeInTheDocument();
    expect(
      screen.getByText("Today at a glance, and how the last 30 days have gone.")
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Analytics" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Invite members" })).toBeInTheDocument();

    expect(
      screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)
    ).toEqual([
      "Last 30 days",
      "Messages per day",
      "Still to come today",
      "Member load, last 30 days",
    ]);
  });

  it("renders every stat card and every period stat", () => {
    render(<OverviewPage />);

    for (const card of STAT_CARDS) {
      expect(screen.getByText(card.label)).toBeInTheDocument();
      expect(screen.getByText(card.value)).toBeInTheDocument();
      expect(screen.getByText(card.note)).toBeInTheDocument();
    }
    for (const stat of PERIOD_STATS) {
      expect(screen.getByText(stat.label)).toBeInTheDocument();
      expect(screen.getByText(stat.value)).toBeInTheDocument();
      expect(screen.getByText(stat.note)).toBeInTheDocument();
    }

    // Every card carries its own overflow control — one per figure, no more.
    expect(screen.getAllByRole("button", { name: /options$/ })).toHaveLength(
      STAT_CARDS.length + PERIOD_STATS.length
    );
    // Only the two declining period stats wear a delta pill.
    const deltas = PERIOD_STATS.filter((stat) => stat.delta);
    expect(deltas).toHaveLength(2);
    for (const stat of deltas) {
      expect(screen.getByText(stat.delta as string)).toBeInTheDocument();
    }
  });

  it("plots one bar and one x-axis tick per day in the period", () => {
    render(<OverviewPage />);

    expect(CHART_BARS).toHaveLength(31);
    expect(screen.getByText("12,480 in the period")).toBeInTheDocument();
    expect(screen.getByTitle(/^1\/7 · /)).toBeInTheDocument();
    expect(screen.getByTitle(/^31\/7 · /)).toBeInTheDocument();
  });

  it("renders every upcoming row with its status chip", () => {
    render(<OverviewPage />);

    const list = screen.getByRole("heading", { name: "Still to come today" })
      .parentElement as HTMLElement;
    const rows = within(list).getAllByRole("listitem");
    expect(rows).toHaveLength(UPCOMING_ROWS.length);

    for (const [index, row] of UPCOMING_ROWS.entries()) {
      const scope = within(rows[index]);
      expect(scope.getByText(row.name)).toBeInTheDocument();
      expect(scope.getByText(`${row.time} · ${row.owner}`)).toBeInTheDocument();
      expect(scope.getByText(row.status)).toBeInTheDocument();
    }
    // Chip variety is the point of the panel: three distinct tones.
    expect(new Set(UPCOMING_ROWS.map((row) => row.tone)).size).toBe(3);
  });

  it("renders one member-load row per member, with its percent", () => {
    render(<OverviewPage />);

    const panel = screen.getByRole("heading", { name: "Member load, last 30 days" })
      .parentElement as HTMLElement;
    const rows = within(panel).getAllByRole("listitem");
    expect(rows).toHaveLength(MEMBER_LOAD_ROWS.length);

    for (const [index, row] of MEMBER_LOAD_ROWS.entries()) {
      const scope = within(rows[index]);
      expect(scope.getByText(row.name)).toBeInTheDocument();
      expect(scope.getByText(`${row.percent}%`)).toBeInTheDocument();
    }
    expect(
      screen.getByText(
        "Share of 735 sessions (denominator shown, as everywhere)"
      )
    ).toBeInTheDocument();
  });
});
