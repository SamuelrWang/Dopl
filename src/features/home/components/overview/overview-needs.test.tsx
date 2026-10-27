// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { HomeNeeds } from "@/features/home/needs-types";
import { HomeOverview } from "./home-overview";
import type { HomeOverviewReads } from "./use-home-overview-reads";
import { CREDITS, HOME_CHANNELS, NEEDS, read, reads } from "./overview-test-fixtures";

afterEach(cleanup);

function mount(state: HomeOverviewReads) {
  const onOpenMessage = vi.fn();
  const onOpenTask = vi.fn();
  render(
    <HomeOverview
      homeWorkspaceId="ws-home"
      homeChannels={HOME_CHANNELS}
      onOpenSettings={vi.fn()}
      onOpenChannel={vi.fn()}
      onOpenMessage={onOpenMessage}
      onOpenTask={onOpenTask}
      useReads={() => state}
    />
  );
  return { onOpenMessage, onOpenTask };
}

const needsCard = () => screen.getByRole("region", { name: "Needs you" });
const needYou = () =>
  within(screen.getByRole("region", { name: "Summary" })).getByText("Need you").nextSibling?.textContent;

describe("Needs you", () => {
  it("lists the spent allowance, then decisions, then tasks, and counts them", () => {
    mount(
      reads({
        needs: read(NEEDS),
        wallet: { loading: false, credits: { ...CREDITS, used: 500, remaining: 0 }, isPaid: false },
      })
    );
    const rows = within(needsCard()).getAllByRole("listitem").map((li) => li.textContent);
    expect(rows[0]).toContain("Out of credits");
    expect(rows[1]).toContain("Ship the migration tonight?");
    expect(rows[1]).toContain("Needs your decision · Coder");
    expect(rows[1]).toContain("#Priya Shah");
    expect(rows[2]).toContain("Review the pricing page");
    expect(rows[2]).toContain("1/3");
    expect(needYou()).toBe("3");
  });

  it("opens a decision at its message and a task on its detail", () => {
    const { onOpenMessage, onOpenTask } = mount(reads({ needs: read(NEEDS) }));
    fireEvent.click(screen.getByRole("button", { name: "Open decision: Ship the migration tonight?" }));
    expect(onOpenMessage).toHaveBeenCalledWith("ws-1", "th-1", 42);
    fireEvent.click(screen.getByRole("button", { name: "Open task: Review the pricing page" }));
    expect(onOpenTask).toHaveBeenCalledWith("ws-1", "t-1");
  });

  it("says a failed read failed, never that nothing is waiting", () => {
    mount(reads({ needs: read<HomeNeeds>(undefined, { error: new Error("boom"), isPending: false }) }));
    expect(within(needsCard()).getByText("Couldn't load your tasks and decisions.")).toBeTruthy();
    expect(within(needsCard()).queryByText("Nothing waiting")).toBeNull();
    expect(needYou()).toBe("—");
  });

  it("ghosts until the read lands", () => {
    mount(reads({ needs: read<HomeNeeds>(undefined) }));
    expect(within(needsCard()).queryByText("Nothing waiting")).toBeNull();
    expect(needYou()).toBe("—");
  });

  it("reads a cached payload that lacks the lists", () => {
    mount(reads({ needs: read({} as HomeNeeds) }));
    expect(within(needsCard()).getByText("Nothing waiting")).toBeTruthy();
    expect(needYou()).toBe("0");
  });

  it("marks a clipped list", () => {
    mount(reads({ needs: read({ ...NEEDS, truncated: { decisions: true, tasks: false } }) }));
    expect(needYou()).toBe("2+");
  });
});
