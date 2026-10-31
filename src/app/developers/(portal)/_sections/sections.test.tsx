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
  usePathname: () => "/developers/users",
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
    expect(screen.queryByRole("link", { name: "Design Playground" })).toBeNull();
    expect(screen.getByText("Sample data")).toBeTruthy();
    const test = screen.getByRole("tab", { name: "Test" });
    fireEvent.click(test);
    expect(test.getAttribute("aria-selected")).toBe("true");
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

  it("filters the catalog and keeps the stats and add cards honest", () => {
    wrap(<DevicesSection />);
    expect(screen.getAllByRole("button", { name: /Add new device/ }).length).toBe(6);
    fireEvent.click(screen.getByRole("button", { name: /^Glasses/ }));
    expect(screen.queryByRole("region", { name: "Desktop" })).toBeNull();
    fireEvent.change(screen.getByPlaceholderText("Search models"), { target: { value: "nothing like this" } });
    expect(screen.getByText("No models match")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.getByRole("region", { name: "Desktop" })).toBeTruthy();
  });
});

describe("API keys", () => {
  const ToTest = () => {
    const { update } = usePortal();
    return (
      <button type="button" onClick={() => update((s) => ({ ...s, env: "test" }))}>
        Switch to test
      </button>
    );
  };

  it("sections keys by type for the environment in the store", () => {
    wrap(
      <>
        <KeysSection />
        <ToTest />
      </>
    );
    const secrets = screen.getByRole("region", { name: "Secret keys" });
    expect(within(secrets).getByRole("article", { name: "Assist backend" })).toBeTruthy();
    expect(within(secrets).queryByRole("article", { name: "Contractor sandbox" })).toBeNull();
    expect(within(screen.getByRole("region", { name: "Publishable keys" })).getByRole("article", { name: "Connect widget" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Switch to test" }));
    expect(screen.getByText("Test data")).toBeTruthy();
    expect(within(screen.getByRole("region", { name: "Secret keys" })).getByRole("article", { name: "Local development" })).toBeTruthy();
    expect(screen.queryByRole("article", { name: "Assist backend" })).toBeNull();
  });

  it("creates a secret one decision at a time, keeps choices on Back, and shows it once", () => {
    wrap(<KeysSection />);
    fireEvent.click(screen.getByRole("button", { name: "Create key" }));
    const dialog = () => within(screen.getByRole("dialog"));
    const next = () => fireEvent.click(dialog().getByRole("button", { name: "Continue" }));
    expect((dialog().getByRole("button", { name: "Continue" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(dialog().getByRole("button", { name: /Secret/ }));
    next();
    fireEvent.click(dialog().getByRole("button", { name: /Read events/ }));
    fireEvent.click(dialog().getByRole("button", { name: "Back" }));
    next();
    expect(dialog().getByRole("button", { name: /Read events/ }).getAttribute("aria-pressed")).toBe("true");
    next();
    expect((dialog().getByRole("button", { name: "Create key" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(dialog().getByRole("textbox", { name: "Key name" }), { target: { value: "Nightly export" } });
    fireEvent.click(dialog().getByRole("button", { name: "Create key" }));
    expect(dialog().getByRole("heading", { name: "Copy your secret key" })).toBeTruthy();
    const secret = dialog().getByText(/^sk_live_.{24}$/).textContent!;
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(dialog().getByRole("button", { name: "Done" }));
    const card = screen.getByRole("article", { name: "Nightly export" });
    expect(within(card).getByText("Not used yet")).toBeTruthy();
    expect(screen.queryByText(secret)).toBeNull();
  });

  it("makes a publishable key without asking for permissions, and it stays readable", () => {
    wrap(<KeysSection />);
    fireEvent.click(within(screen.getByRole("article", { name: "Connect widget" })).getByRole("button", { name: "Revoke" }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Revoke key" }));
    fireEvent.click(screen.getByRole("button", { name: /New publishable key/ }));
    const dialog = () => within(screen.getByRole("dialog"));
    expect(dialog().getByRole("heading", { name: "Name this key" })).toBeTruthy();
    fireEvent.change(dialog().getByRole("textbox", { name: "Key name" }), { target: { value: "Mobile app" } });
    fireEvent.click(dialog().getByRole("button", { name: "Create key" }));
    const token = dialog().getByText(/^pk_live_.{24}$/).textContent!;
    fireEvent.click(dialog().getByRole("button", { name: "Done" }));
    expect(within(screen.getByRole("article", { name: "Mobile app" })).getByText(token)).toBeTruthy();
  });

  it("confirms a revoke, then moves the key to Revoked", () => {
    wrap(<KeysSection />);
    const card = () => screen.getByRole("article", { name: "Assist backend" });
    fireEvent.click(within(card()).getByRole("button", { name: "Revoke" }));
    const confirm = screen.getByRole("alertdialog");
    expect(within(confirm).getByText("In use. Its calls fail at once.")).toBeTruthy();
    fireEvent.click(within(confirm).getByRole("button", { name: "Cancel" }));
    fireEvent.click(within(card()).getByRole("button", { name: "Revoke" }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Revoke key" }));
    expect(screen.queryByRole("article", { name: "Assist backend" })).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "Revoked" }));
    expect(within(card()).queryByRole("button", { name: "Revoke" })).toBeNull();
  });

  it("rotates with a grace period and reveals the new secret", () => {
    wrap(<KeysSection />);
    fireEvent.click(within(screen.getByRole("article", { name: "Dispatch worker" })).getByRole("button", { name: "Rotate" }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Rotate key" }));
    const dialog = within(screen.getByRole("dialog"));
    expect(dialog.getByRole("heading", { name: "Copy your new secret" })).toBeTruthy();
    fireEvent.click(dialog.getByRole("button", { name: "Done" }));
    const card = within(screen.getByRole("article", { name: "Dispatch worker" }));
    expect(card.getByText("Old secret ends in 24h")).toBeTruthy();
    expect(card.queryByText(/sk_live_Ld71/)).toBeNull();
  });

  // Stale against the fixture UI before the 2026-10-31 move; Phase 3 of docs/specs/dev-portal-live/PLAN.md rewrites this page.
  it.skip("finds unused keys, and answers an empty search", () => {
    wrap(<KeysSection />);
    fireEvent.click(screen.getByRole("button", { name: /Needs review/ }));
    expect(screen.getByRole("article", { name: "Old reporting job" })).toBeTruthy();
    expect(screen.queryByRole("article", { name: "Assist backend" })).toBeNull();
    fireEvent.change(screen.getByPlaceholderText("Search keys"), { target: { value: "nothing like this" } });
    expect(screen.getByText("No keys match")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.getByRole("article", { name: "Assist backend" })).toBeTruthy();
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
  // Stale against the fixture UI before the 2026-10-31 move; Phase 3 of docs/specs/dev-portal-live/PLAN.md rewrites this page.
  it.skip("starts, shows the test send on its screen, and takes a tap", async () => {
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
  // Stale against the fixture UI before the 2026-10-31 move; Phase 3 of docs/specs/dev-portal-live/PLAN.md rewrites this page.
  it.skip("overrides inline, moves the source label, and resets to inherited", () => {
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

  // Stale against the fixture UI before the 2026-10-31 move; Phase 3 of docs/specs/dev-portal-live/PLAN.md rewrites this page.
  it.skip("clamps an override to the model's floor", () => {
    wrap(<IntegrationPageSection integrationId="even_realities" initialTab="receives" />);
    const row = () => screen.getByText("Max lines").closest("li")!;
    fireEvent.click(within(row()).getByRole("button", { name: "Override" }));
    fireEvent.change(within(row()).getByRole("spinbutton"), { target: { value: "40" } });
    expect((within(row()).getByRole("spinbutton") as HTMLInputElement).value).toBe("4");
  });

  // Stale against the fixture UI before the 2026-10-31 move; Phase 3 of docs/specs/dev-portal-live/PLAN.md rewrites this page.
  it.skip("walks a draft to Test and then Live", () => {
    wrap(<IntegrationPageSection integrationId="even_realities" initialTab="receives" />);
    fireEvent.click(within(screen.getByText("Max lines").closest("li")!).getByRole("button", { name: "Override" }));
    fireEvent.click(screen.getByRole("button", { name: "Publish to Test" }));
    expect(screen.getByText("Test v8")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Promote to Live" }));
    expect(screen.getByText("Live v8")).toBeTruthy();
  });
});

describe("Activity", () => {
  // Stale against the fixture UI before the 2026-10-31 move; Phase 3 of docs/specs/dev-portal-live/PLAN.md rewrites this page.
  it.skip("opens the stale pairing case from a link, with the unknowable step labelled", () => {
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
