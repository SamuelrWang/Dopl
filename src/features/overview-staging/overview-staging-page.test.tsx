// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { OverviewStagingPage } from "./overview-staging-page";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

describe("/overview staging", () => {
  it("renders every Overview section and opens the clickable flows", async () => {
    vi.useFakeTimers();
    globalThis.ResizeObserver ??= class { observe() {} disconnect() {} unobserve() {} } as never;
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    render(<OverviewStagingPage />);
    await act(async () => { vi.advanceTimersByTime(1000); });
    for (const t of ["Devices", "Usage", "Token spend", "All channels", "Credits by channel", "Messages by channel", "Credit usage by person", "Top MCP tools", "Routing", "Logs", "Credit spend"]) {
      expect(screen.getAllByText(t).length).toBeGreaterThan(0);
    }
    fireEvent.click(screen.getByText("Add device"));
    expect(screen.getByText("Add a device")).toBeTruthy();
    fireEvent.click(screen.getByText("Glasses"));
    expect(screen.getByLabelText("Pairing code")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Previous month"));
    await act(async () => { vi.advanceTimersByTime(1000); });
    fireEvent.click(screen.getByLabelText("Usage scope"));
    expect(screen.getAllByText("Desktop agent").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByText("Get more credits"));
    await act(async () => { vi.advanceTimersByTime(100); });
    expect(screen.getAllByText("Plans & Billing").length).toBeGreaterThan(0);
    expect(document.body.textContent).toMatch(/\$\d/);
    expect(document.body.textContent).toContain("Max");
    fireEvent.click(screen.getByText("Workspaces"));
    expect(screen.getByText("Northwind")).toBeTruthy();
    fireEvent.click(screen.getByText("Error"));
    await act(async () => { vi.advanceTimersByTime(1000); });
    expect(screen.getByText("Could not load Overview.")).toBeTruthy();
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
