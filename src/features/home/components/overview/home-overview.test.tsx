// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { HomeOverview } from "./home-overview";
import type { HomeOverview as HomeOverviewPayload } from "@/features/home/overview-types";
import type { HomeOverviewReads } from "./use-home-overview-reads";
import { CREDITS, DEVICES, HOME_CHANNELS, OVERVIEW, read, reads } from "./overview-test-fixtures";

afterEach(cleanup);

function mount(state: HomeOverviewReads = reads()) {
  const onOpenSettings = vi.fn();
  render(
    <HomeOverview
      homeWorkspaceId="ws-home"
      homeChannels={HOME_CHANNELS}
      onOpenSettings={onOpenSettings}
      onOpenChannel={vi.fn()}
      onOpenMessage={vi.fn()}
      onOpenTask={vi.fn()}
      useReads={() => state}
    />
  );
  return { onOpenSettings };
}

const card = (name: string) => screen.getByRole("region", { name });

describe("/home Overview face", () => {
  it("renders each card once", () => {
    mount();
    for (const name of ["Summary", "Needs you", "Devices", "Credits", "Tokens", "Channels", "People", "MCP tools"]) {
      expect(screen.getAllByRole("region", { name })).toHaveLength(1);
    }
  });

  it("ghosts the face until the overview lands, and says so", () => {
    mount(reads({ overview: read<HomeOverviewPayload>(undefined) }));
    expect(screen.getByRole("status").textContent).toContain("Loading overview");
    expect(screen.queryByRole("region", { name: "Credits" })).toBeNull();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("shows the error with Try again and Reload", () => {
    const refetch = vi.fn();
    mount(reads({ overview: read<HomeOverviewPayload>(undefined, { error: new Error("boom"), refetch }) }));
    expect(screen.getByRole("alert")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(refetch).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Reload" })).toBeTruthy();
  });

  it("never draws an unknown read as empty", () => {
    mount(reads({ wallet: { loading: true, credits: CREDITS, isPaid: false }, devices: { devices: null, failed: false } }));
    expect(within(card("Needs you")).queryByText("Nothing waiting")).toBeNull();
    expect(within(card("Devices")).queryByText("No devices yet")).toBeNull();
    expect(within(card("Summary")).getAllByText("—")).toHaveLength(3);
    expect(within(card("Credits")).queryByText("Get more credits")).toBeNull();
  });

  it("puts a spent allowance in Needs you, with the offer and the paused note once", () => {
    mount(reads({ wallet: { loading: false, credits: { ...CREDITS, used: 500, remaining: 0 }, isPaid: false } }));
    const needs = card("Needs you");
    expect(within(needs).getByText("Out of credits")).toBeTruthy();
    expect(within(needs).getByText(/^Resets /)).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Get more credits" })).toHaveLength(1);
    expect(within(card("Credits")).getByRole("button", { name: "Get more credits" })).toBeTruthy();
    expect(screen.getAllByText(/Tool calls are paused/)).toHaveLength(1);
    expect(within(card("Summary")).getByText("Need you").nextSibling?.textContent).toContain("1");
  });

  it("lists every device and sends Add device to Settings › Devices", () => {
    const { onOpenSettings } = mount();
    const devices = card("Devices");
    expect(within(devices).getByText("1/2 online")).toBeTruthy();
    expect(within(devices).getByText("This computer")).toBeTruthy();
    expect(within(devices).getByText("macOS · Dopl 1.43.0")).toBeTruthy();
    expect(within(devices).getByText("Online")).toBeTruthy();
    expect(within(devices).getByText("Offline")).toBeTruthy();
    fireEvent.click(within(devices).getByRole("button", { name: "Add device" }));
    expect(onOpenSettings).toHaveBeenCalledWith("devices");
  });

  it("says a failed computers read failed", () => {
    mount(reads({ devices: { devices: DEVICES.slice(1), failed: true } }));
    expect(within(card("Devices")).getByText("Couldn't load your computers.")).toBeTruthy();
    expect(within(card("Summary")).getByText("Devices online").nextSibling?.textContent).toContain("—");
  });

  it("carries the ledger's fallbacks and the guest subtotal", () => {
    mount(reads({ overview: read({ ...OVERVIEW, truncated: true }) }));
    expect(within(card("Channels")).getByText("#Priya Shah")).toBeTruthy();
    expect(within(card("Channels")).getByText("Untitled channel")).toBeTruthy();
    const people = card("People");
    expect(within(people).getByText("1 guest · 12")).toBeTruthy();
    expect(within(people).getByText("Unknown member")).toBeTruthy();
    expect(within(card("MCP tools")).getByText(".list")).toBeTruthy();
    expect(screen.getByText("From the newest 476 events.")).toBeTruthy();
  });

  it("reads a persisted payload that lacks the array keys", () => {
    const stale = { ...OVERVIEW, channels: undefined, people: undefined, tools: undefined };
    mount(reads({ overview: read(stale as never) }));
    expect(within(card("Channels")).getByText("No channel activity this month")).toBeTruthy();
    expect(within(card("People")).getByText("No credits spent yet")).toBeTruthy();
    expect(within(card("MCP tools")).getByText("No tool calls yet")).toBeTruthy();
  });
});
