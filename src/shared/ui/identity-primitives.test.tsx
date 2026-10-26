// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Check } from "lucide-react";
import { Breadcrumb } from "./breadcrumb";
import { EmptyState } from "./empty-state";
import { StatusPill } from "./status-pill";
import { ThinMeter } from "./usage-meter";

afterEach(cleanup);

describe("StatusPill", () => {
  it("wears the kit pill with its tone and a dot by default", () => {
    render(<StatusPill tone="live">Working</StatusPill>);
    const pill = screen.getByText("Working");
    expect(pill.className).toBe("status-pill");
    expect(pill.dataset.tone).toBe("live");
    expect(pill.querySelector(".status-pill-dot")).toBeTruthy();
  });

  it("drops the dot on request and defaults to neutral", () => {
    render(<StatusPill dot={false}>Open</StatusPill>);
    const pill = screen.getByText("Open");
    expect(pill.dataset.tone).toBe("neutral");
    expect(pill.querySelector(".status-pill-dot")).toBeNull();
  });
});

describe("ThinMeter", () => {
  const fill = (el: HTMLElement) => (el.firstElementChild as HTMLElement).style.width;

  it("fills to the rounded percentage and caps at 100", () => {
    const { container, rerender } = render(<ThinMeter used={1} limit={3} />);
    const bar = container.firstElementChild as HTMLElement;
    expect(bar.getAttribute("aria-hidden")).toBe("true");
    expect(bar.className).toContain("h-0.75");
    expect(fill(bar)).toBe("33%");
    rerender(<ThinMeter used={9} limit={3} />);
    expect(fill(bar)).toBe("100%");
  });

  it("draws an empty bar when there is no limit", () => {
    const { container } = render(<ThinMeter used={4} limit={0} />);
    expect(fill(container.firstElementChild as HTMLElement)).toBe("0%");
  });
});

describe("EmptyState well", () => {
  it("is an icon and one phrase inside the card well", () => {
    const { container } = render(<EmptyState variant="well" icon={Check} title="No tasks yet" />);
    const well = container.firstElementChild as HTMLElement;
    expect(well.className).toContain("card-well");
    expect(well.textContent).toBe("No tasks yet");
    expect(well.querySelector("svg")).toBeTruthy();
  });
});

describe("Breadcrumb", () => {
  it("makes earlier crumbs buttons and marks the last one current", () => {
    const back = vi.fn();
    render(
      <Breadcrumb
        items={[
          { key: "tasks", label: "Tasks", onSelect: back, ariaLabel: "Back to tasks" },
          { key: "t1", label: "Fix the leak" },
        ]}
      />
    );
    const nav = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(nav.textContent).toBe("Tasks›Fix the leak");
    fireEvent.click(screen.getByRole("button", { name: "Back to tasks" }));
    expect(back).toHaveBeenCalledOnce();
    expect(screen.getByText("Fix the leak").closest("[aria-current]")?.getAttribute("aria-current")).toBe("page");
    expect(screen.queryByRole("button", { name: "Fix the leak" })).toBeNull();
  });
});
