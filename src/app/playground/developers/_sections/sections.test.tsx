// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { PortalProvider, usePortal } from "../_components/portal-store";
import { PortalShell } from "../_components/portal-shell";
import { ActivitySection } from "./activity";
import { ConnectSection } from "./connect";
import { AddDeviceDialog } from "./add-device-dialog";
import { DevicesSection } from "./devices";
import { IntegrationPageSection } from "./integration-page";
import { IssuesSection } from "./issues";
import { KeysSection } from "./keys";
import { OverviewSection } from "./overview";
import { PlaygroundSection } from "./playground";
import { TeamSection } from "./team";
import { UsageSection } from "./usage";
import { UserPageSection } from "./user-page";
import { UsersSection } from "./users";
import { WebhooksSection } from "./webhooks";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  usePathname: () => "/playground/developers/users",
}));

beforeAll(() => {
  // jsdom has neither; the kit's popover and frame read them.
  window.matchMedia ??= ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as never;
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as never;
});

afterEach(cleanup);

const wrap = (node: ReactNode) => render(<PortalProvider>{node}</PortalProvider>);

describe("every page renders on the fixtures", () => {
  it.each([
    ["Overview", <OverviewSection key="o" />],
    ["Devices", <DevicesSection key="d" />],
    ["Users", <UsersSection key="u" />],
    ["Issues", <IssuesSection key="i" />],
    ["API keys", <KeysSection key="k" />],
    ["Webhooks", <WebhooksSection key="w" />],
    ["Usage", <UsageSection key="us" />],
    ["Team", <TeamSection key="t" />],
    ["Connect page", <ConnectSection key="c" />],
    ["Playground", <PlaygroundSection key="p" />],
  ])("%s", (title, node) => {
    wrap(node);
    expect(screen.getByRole("heading", { level: 1, name: title })).toBeTruthy();
  });

  it("the sidebar lists the three groups and the find box", () => {
    wrap(
      <PortalShell>
        <div />
      </PortalShell>
    );
    for (const name of ["Build", "Operate", "Configure"]) expect(screen.getByText(name)).toBeTruthy();
    expect(screen.getByPlaceholderText("Find anything")).toBeTruthy();
  });
});

describe("Users", () => {
  it("narrows by quick view and opens a user in a sheet with metadata only", () => {
    wrap(<UsersSection />);
    expect(screen.queryByText("of 25")).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "Needs attention" }));
    expect(screen.getByText("of 25")).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: /.+/ }).find((n) => n.getAttribute("aria-haspopup") === "dialog")!);
    const sheet = screen.getByRole("dialog");
    expect(within(sheet).getByText("Latest deliveries")).toBeTruthy();
    expect(within(sheet).getByRole("link", { name: "Open full page" })).toBeTruthy();
    expect(within(sheet).queryByText(/Test message/)).toBeNull();
  });
});

describe("Devices", () => {
  it("groups by category with an add card in each section", () => {
    wrap(<DevicesSection />);
    const robots = screen.getByRole("region", { name: "Robots" });
    expect(within(robots).getByRole("button", { name: /Add new device/ })).toBeTruthy();
    const glasses = screen.getByRole("region", { name: "Glasses" });
    expect(within(glasses).getByText("Even Realities")).toBeTruthy();
    expect(within(glasses).getByText("G2")).toBeTruthy();
    expect(within(glasses).queryByText("Coming soon")).toBeNull();
    expect(screen.queryByText("Simulator")).toBeNull();
  });
});

describe("Add new device", () => {
  it("picks a model and goes live, warning about tests that have not passed without blocking", async () => {
    const Probe = () => <output>{usePortal().state.integrations.meta?.status}</output>;
    const onClose = vi.fn();
    wrap(
      <>
        <AddDeviceDialog initialCategory="glasses" onClose={onClose} />
        <Probe />
      </>
    );
    expect(await screen.findByRole("heading", { name: "Choose a device" })).toBeTruthy();
    const next = () => fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: /Meta glasses/ }));
    next();
    fireEvent.click(screen.getByRole("button", { name: /Simulator/ }));
    next();
    next();
    next();
    expect(screen.getByText(/tests have not passed/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("heading", { name: "Run capability tests" })).toBeTruthy();
    next();
    fireEvent.click(screen.getByRole("button", { name: "Go live" }));
    expect(screen.getByRole("status").textContent).toBe("live");
    expect(onClose).toHaveBeenCalled();
  });
});

describe("The simulator in the live preview", () => {
  it("starts, shows the test send on its screen, and takes a tap", async () => {
    wrap(<IntegrationPageSection integrationId="even_realities" initialTab="receives" />);
    fireEvent.click(screen.getByRole("button", { name: "Start simulator" }));
    expect(screen.getByText("Waiting for a message")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Send test" }));
    expect(await screen.findByText("Queued")).toBeTruthy();
    expect(await screen.findByText("Seen by device", {}, { timeout: 2000 })).toBeTruthy();
    expect(screen.queryByText("Waiting for a message")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(screen.getByRole("button", { name: "Start simulator" })).toBeTruthy();
  });
});

describe("What it receives", () => {
  it("overrides inline, moves the source label, and resets to inherited", () => {
    wrap(<IntegrationPageSection integrationId="even_realities" initialTab="receives" />);
    const row = () => screen.getByText("Max lines").closest("li")!;
    expect(within(row()).getByText("Dopl default")).toBeTruthy();
    fireEvent.click(within(row()).getByRole("button", { name: "Override" }));
    expect(within(row()).getByText("Your project · Glasses")).toBeTruthy();
    fireEvent.change(within(row()).getByRole("spinbutton"), { target: { value: "2" } });
    expect(screen.getByText(/Fits 2 of/)).toBeTruthy();
    fireEvent.click(within(row()).getByRole("button", { name: "Reset to inherited" }));
    expect(within(row()).getByText("Dopl default")).toBeTruthy();
  });

  it("clamps an override to the model's floor", () => {
    wrap(<IntegrationPageSection integrationId="even_realities" initialTab="receives" />);
    const row = () => screen.getByText("Max lines").closest("li")!;
    fireEvent.click(within(row()).getByRole("button", { name: "Override" }));
    fireEvent.change(within(row()).getByRole("spinbutton"), { target: { value: "40" } });
    expect((within(row()).getByRole("spinbutton") as HTMLInputElement).value).toBe("4");
  });

  it("walks a draft to Test and then Live", () => {
    wrap(<IntegrationPageSection integrationId="even_realities" initialTab="receives" />);
    fireEvent.click(within(screen.getByText("Max lines").closest("li")!).getByRole("button", { name: "Override" }));
    fireEvent.click(screen.getByRole("button", { name: "Publish to Test" }));
    expect(screen.getByText("Test v8")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Promote to Live" }));
    expect(screen.getByText("Live v8")).toBeTruthy();
  });
});

describe("Activity", () => {
  it("opens the stale pairing case from a link, with the unknowable step labelled", () => {
    wrap(<ActivitySection initial={{ call: "del_7f3a91" }} />);
    expect(screen.getAllByText("Refused")).toHaveLength(2);
    expect(screen.getByText("Read by the person")).toBeTruthy();
  });
});

describe("User page", () => {
  it("shows each physical device with its trail and firmware", () => {
    wrap(<UserPageSection userId="tech_1107" />);
    expect(screen.getByText("Tomasz's G2")).toBeTruthy();
    expect(screen.getAllByText("Glasses › Even Realities › G2")).toHaveLength(3);
    expect(screen.getAllByText("1.3.8").length).toBeGreaterThan(0);
  });

  it("offers a closed set of preferences, never free text", () => {
    wrap(<UserPageSection userId="tech_1107" initialTab="preferences" />);
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.getByRole("button", { name: "Language" })).toBeTruthy();
  });
});
