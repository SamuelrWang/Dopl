// @vitest-environment jsdom
//
// Version D: the toolbar switch swaps the whole Overview face; the page LEADS with the "Right now"
// hero (agents + what needs you), then a three-card support row, then the activity log; the cut
// sections stay cut; and the staging states still reach it.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { OverviewStagingPage } from "../../../overview-staging-page";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

async function settle() {
  await act(async () => {
    vi.advanceTimersByTime(1000);
  });
}

async function openVersionD() {
  render(<OverviewStagingPage />);
  fireEvent.click(screen.getByText("Version D"));
  await settle();
}

const region = (name: string) => screen.getByRole("region", { name });

describe("Overview Version D", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    globalThis.ResizeObserver ??= class { observe() {} disconnect() {} unobserve() {} } as never;
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("the switch swaps the face, and Current is still the default", async () => {
    render(<OverviewStagingPage />);
    await settle();
    expect(screen.getAllByText("Credits by channel").length).toBeGreaterThan(0);
    expect(document.querySelector(".ovd")).toBeNull();

    fireEvent.click(screen.getByText("Version D"));
    await settle();
    expect(document.querySelector(".ovd")).not.toBeNull();
    expect(screen.queryByText("Credits by channel")).toBeNull();

    fireEvent.click(screen.getByText("Current"));
    await settle();
    expect(document.querySelector(".ovd")).toBeNull();
  });

  it("leads with the Right now hero, then the support row, then activity", async () => {
    await openVersionD();
    const order = [...document.querySelectorAll(".ovd-inner > *, .ovd-support > section")]
      .map((el) => el.getAttribute("aria-label"))
      .filter(Boolean);
    expect(order).toEqual(["Right now", "Spend", "Devices", "Top channels", "Activity"]);
  });

  it("the hero answers what is live and what needs you", async () => {
    await openVersionD();
    const hero = region("Right now");
    // Every running agent, as an identity face (photo + runtime badge) row.
    for (const name of ["Orchestrator", "Devices Dashboard Mock", "Landing Copy Fix", "Nightly Audit"]) {
      expect(within(hero).getAllByText(name).length).toBeGreaterThan(0);
    }
    expect(within(hero).getAllByText("Waiting for you").length).toBe(2);
    expect(within(hero).getByText("Wants to post in Dopl")).toBeTruthy();
    // Resolving an ask takes it off the hero and the agent's pill off amber.
    fireEvent.click(within(hero).getByText("Approve"));
    expect(within(hero).queryByText("Wants to post in Dopl")).toBeNull();
    expect(within(hero).getAllByText("Waiting for you").length).toBe(1);
  });

  it("keeps the cut sections cut", async () => {
    await openVersionD();
    const text = document.querySelector(".ovd")?.textContent ?? "";
    for (const cut of ["Messages by channel", "Credit usage by person", "Top MCP tools", "Reach order"]) {
      expect(text).not.toContain(cut);
    }
    expect(region("Top channels").querySelectorAll(".ovd-rank").length).toBe(5);
    expect(region("Activity").querySelectorAll(".ovd-log-row").length).toBe(4);
  });

  it("filters the activity log by device", async () => {
    await openVersionD();
    const log = region("Activity");
    fireEvent.click(within(log).getByRole("tab", { name: "Dopl web" }));
    const rows = log.querySelectorAll(".ovd-log-row");
    expect(rows.length).toBe(1);
    expect(rows[0].textContent).toContain("Sign-in expired");
  });

  it("opens the same flows as Current", async () => {
    await openVersionD();
    fireEvent.click(screen.getByText("Add device"));
    expect(screen.getByText("Add a device")).toBeTruthy();
    fireEvent.click(screen.getByText("Get more credits"));
    await act(async () => {
      vi.advanceTimersByTime(100);
    });
    expect(screen.getAllByText("Plans & Billing").length).toBeGreaterThan(0);
  });

  it("out of credits becomes a needs-you item in the hero", async () => {
    await openVersionD();
    fireEvent.click(screen.getByText("Out of credits"));
    await settle();
    const hero = region("Right now");
    expect(within(hero).getByText("Out of credits")).toBeTruthy();
    expect(region("Spend").querySelector('.ovd-meter[data-tone="needs-you"]')).not.toBeNull();
  });

  it("devices preview off drops the device-backed parts", async () => {
    await openVersionD();
    fireEvent.click(screen.getByText("Off"));
    await settle();
    expect(screen.queryByRole("region", { name: "Devices" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Activity" })).toBeNull();
    expect(within(region("Right now")).getByText("No agents running.")).toBeTruthy();
  });

  it("handles the empty and error reads", async () => {
    await openVersionD();
    fireEvent.click(screen.getByText("Empty"));
    await settle();
    expect(within(region("Top channels")).getByText("Nothing yet.")).toBeTruthy();
    fireEvent.click(screen.getByText("Error"));
    await settle();
    expect(screen.getByText("Could not load Overview.")).toBeTruthy();
  });
});
