// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { OverviewStagingPage } from "./overview-staging-page";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {} }) }));

const tick = async (ms: number) => {
  for (let round = 0; round < 3; round += 1) {
    await act(async () => {
      vi.advanceTimersByTime(ms);
    });
  }
};

describe("/overview staging", () => {
  afterEach(cleanup);

  it("renders the Proposed face by default and the switch flips to Current", async () => {
    vi.useFakeTimers();
    globalThis.ResizeObserver ??= class { observe() {} disconnect() {} unobserve() {} } as never;
    render(<OverviewStagingPage />);
    await tick(1000);
    expect(screen.getByRole("region", { name: "Usage" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Needs you" })).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Summary" })).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "Tokens" }));
    expect(screen.getByRole("list", { name: /Daily tokens/ })).toBeTruthy();
    fireEvent.click(within(screen.getByLabelText("Staging controls")).getByText("Current"));
    await tick(1000);
    expect(screen.getByRole("region", { name: "Summary" })).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Usage" })).toBeNull();
    vi.useRealTimers();
  });

  it("renders the Overview and opens Settings without a network call", async () => {
    vi.useFakeTimers();
    globalThis.ResizeObserver ??= class { observe() {} disconnect() {} unobserve() {} } as never;
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    render(<OverviewStagingPage />);
    await tick(1000);
    fireEvent.click(within(screen.getByLabelText("Staging controls")).getByText("Current"));
    await tick(1000);
    expect(screen.getByRole("region", { name: "Summary" })).toBeTruthy();
    fireEvent.click(within(screen.getByRole("region", { name: "Credits" })).getByText("Get more credits"));
    await tick(400);
    expect(screen.getAllByText("Plans & Billing").length).toBeGreaterThan(0);
    expect(document.body.textContent).toMatch(/\$\d/);
    expect(document.body.textContent).toContain("Max");
    fireEvent.click(screen.getByText("Workspaces"));
    await tick(400);
    expect(screen.getByText("Northwind")).toBeTruthy();
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
