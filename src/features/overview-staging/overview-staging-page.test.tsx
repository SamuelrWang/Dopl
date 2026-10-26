// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { OverviewStagingPage } from "./overview-staging-page";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

describe("/overview staging", () => {
  it("renders the Overview and opens Settings without a network call", async () => {
    vi.useFakeTimers();
    globalThis.ResizeObserver ??= class { observe() {} disconnect() {} unobserve() {} } as never;
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    render(<OverviewStagingPage />);
    await act(async () => { vi.advanceTimersByTime(1000); });
    expect(screen.getByRole("region", { name: "Summary" })).toBeTruthy();
    fireEvent.click(within(screen.getByRole("region", { name: "Credits" })).getByText("Get more credits"));
    await act(async () => { vi.advanceTimersByTime(100); });
    expect(screen.getAllByText("Plans & Billing").length).toBeGreaterThan(0);
    expect(document.body.textContent).toMatch(/\$\d/);
    expect(document.body.textContent).toContain("Max");
    fireEvent.click(screen.getByText("Workspaces"));
    expect(screen.getByText("Northwind")).toBeTruthy();
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
