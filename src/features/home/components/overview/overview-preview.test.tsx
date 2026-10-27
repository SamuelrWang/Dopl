// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { OverviewPreviewSchema } from "@/features/home/preview-types";
import SEED from "@/features/overview-staging/overview-preview-seed.json";
import { HomeOverview } from "./home-overview";
import type { HomeOverviewReads } from "./use-home-overview-reads";
import { HOME_CHANNELS, reads } from "./overview-test-fixtures";

afterEach(cleanup);

const PREVIEW = OverviewPreviewSchema.parse(SEED);

function mount(state: HomeOverviewReads) {
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

describe("/home Overview with preview data", () => {
  it("keeps every seeded part through validation", () => {
    for (const part of ["hosts", "routes", "logs", "reachOrder", "devices", "addDevice", "needs"] as const) {
      expect(PREVIEW[part], part).toBeDefined();
    }
  });

  it("shows no preview card without preview data", () => {
    mount(reads());
    expect(screen.queryByRole("region", { name: "Agents" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Activity" })).toBeNull();
    expect(within(card("Summary")).queryByText("Working")).toBeNull();
  });

  it("draws Agents by computer, Activity tabs, the Working cell and the agents' asks", () => {
    mount(reads({ preview: PREVIEW }));
    expect(within(card("Summary")).getByText("Working")).toBeTruthy();
    const agents = card("Agents");
    expect(within(agents).getByRole("group", { name: "Samuel's MacBook Pro" })).toBeTruthy();
    expect(within(agents).getByText("Release Captain")).toBeTruthy();
    const activity = card("Activity");
    expect(within(activity).getByRole("list", { name: "Routing" })).toBeTruthy();
    fireEvent.click(within(activity).getByRole("tab", { name: "Logs" }));
    expect(within(activity).getByRole("list", { name: "Logs" })).toBeTruthy();
    expect(within(card("Needs you")).getByText("Wants to post release notes in #Dopl")).toBeTruthy();
  });

  it("lays preview detail over the real device rows and lists preview-only devices", () => {
    mount(reads({ preview: PREVIEW }));
    const devices = card("Devices");
    expect(within(devices).getByRole("list", { name: "Reach order" })).toBeTruthy();
    expect(within(devices).getByText("In use")).toBeTruthy();
    expect(within(devices).getByText("64%")).toBeTruthy();
    expect(within(devices).getAllByText("Samuel's iPhone")).toHaveLength(2);
    expect(within(devices).getByText("iPhone 17 Pro · through Samuel's MacBook Pro")).toBeTruthy();
  });

  it("opens the kind picker with the pairing code, and Pair still opens Settings › Devices", () => {
    const { onOpenSettings } = mount(reads({ preview: PREVIEW }));
    const devices = card("Devices");
    fireEvent.click(within(devices).getByRole("button", { name: "Add device" }));
    fireEvent.click(within(devices).getByRole("button", { name: "Glasses" }));
    expect(within(devices).getByText("K7Q2M9")).toBeTruthy();
    fireEvent.click(within(devices).getByRole("button", { name: "Pair" }));
    expect(onOpenSettings).toHaveBeenCalledWith("devices");
  });
});
