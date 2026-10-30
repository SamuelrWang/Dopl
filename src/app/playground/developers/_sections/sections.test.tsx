// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { PortalShell } from "../_components/portal-shell";
import { PortalProvider } from "../_components/portal-store";
import { DashboardSection, maskKey } from "./dashboard";
import { LogsSection } from "./logs";

vi.mock("next/navigation", () => ({ usePathname: () => "/playground/developers" }));

beforeAll(() => {
  window.matchMedia ??= ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as never;
});

afterEach(cleanup);

const wrap = (node: ReactNode) => render(<PortalProvider>{node}</PortalProvider>);

describe("shell", () => {
  it("has two nav items and no search", () => {
    wrap(
      <PortalShell>
        <div />
      </PortalShell>
    );
    const nav = screen.getByRole("navigation", { name: "Developer portal" });
    expect(within(nav).getAllByRole("link").map((a) => a.textContent)).toEqual(["Dashboard", "Logs"]);
    expect(screen.queryByPlaceholderText("Find anything")).toBeNull();
  });
});

describe("dashboard", () => {
  it("shows usage, a masked key and integrations by category", () => {
    wrap(<DashboardSection />);
    expect(screen.getByText("API calls")).toBeTruthy();
    expect(screen.getByText(maskKey("sk_live_demo-sample-fixture-only"))).toBeTruthy();
    expect(within(screen.getByRole("region", { name: "Glasses" })).getByRole("button", { name: "Even Realities" })).toBeTruthy();
    expect(within(screen.getByRole("region", { name: "Robots" })).getByText("No integration yet")).toBeTruthy();
  });

  it("opens one integration in a dialog and removes it", async () => {
    wrap(<DashboardSection />);
    fireEvent.click(screen.getByRole("button", { name: "Even Realities" }));
    expect(await screen.findByRole("button", { name: "Test on simulator" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(screen.queryByRole("button", { name: "Even Realities" })).toBeNull();
    expect(screen.getByText("Not added")).toBeTruthy();
  });

  it("adds an integration in one pick", async () => {
    wrap(<DashboardSection />);
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    fireEvent.click(await screen.findByRole("button", { name: "Mentra" }));
    expect(within(screen.getByRole("region", { name: "Glasses" })).getByText("Testing")).toBeTruthy();
  });
});

describe("logs", () => {
  it("shows aggregates and no rows until a user id is searched", () => {
    wrap(<LogsSection />);
    expect(screen.getByText("By integration")).toBeTruthy();
    expect(screen.queryByText("Latency")).toBeNull();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "tech_1107" } });
    expect(screen.getByText("Latency")).toBeTruthy();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "nobody" } });
    expect(screen.getByText("No calls for this user ID")).toBeTruthy();
  });
});
