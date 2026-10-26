// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
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
async function openPage() {
  render(<OverviewStagingPage />);
  await settle();
}
const card = (name: string) => screen.getByRole("region", { name });
const text = () => document.body.textContent ?? "";

describe("Overview staging face", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    globalThis.ResizeObserver ??= class { observe() {} disconnect() {} unobserve() {} } as never;
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("carries the inventoried information", async () => {
    await openPage();
    // Summary strip.
    const strip = card("Summary");
    for (const label of ["Working", "Need you", "Devices online", "Credits left"]) {
      expect(within(strip).getByText(label)).toBeTruthy();
    }
    // Needs you: both asks, each resolvable.
    const needs = card("Needs you");
    expect(within(needs).getByText("Wants to post in Dopl")).toBeTruthy();
    expect(within(needs).getByText("Which account should the outreach go from?")).toBeTruthy();
    fireEvent.click(within(needs).getByText("Approve"));
    expect(within(needs).queryByText("Wants to post in Dopl")).toBeNull();
    // Agents by computer.
    const agents = card("Agents");
    for (const n of ["Orchestrator", "Devices Dashboard Mock", "Landing Copy Fix", "Nightly Audit", "Samuel's MacBook Pro", "Studio Mac", "This computer"]) {
      expect(within(agents).getAllByText(n).length).toBeGreaterThan(0);
    }
    expect(within(agents).getByText("3h 4m")).toBeTruthy();
    // Activity: routing, then logs.
    const activity = card("Activity");
    expect(within(activity).getByText("Keep the SDK section or hide it?")).toBeTruthy();
    expect(within(activity).getByText("3/5 first try")).toBeTruthy();
    fireEvent.click(within(activity).getByRole("tab", { name: "Logs" }));
    expect(within(activity).getByText("Sign-in expired")).toBeTruthy();
    // Credits: allowance, scope, month, histogram.
    const credits = card("Credits");
    expect(within(credits).getByText("312")).toBeTruthy();
    expect(within(credits).getByText("188 left")).toBeTruthy();
    expect(within(credits).getByText(/Resets /)).toBeTruthy();
    expect(within(credits).getByRole("img", { name: /Daily credits/ })).toBeTruthy();
    fireEvent.click(within(credits).getByRole("button", { name: "Usage scope" }));
    fireEvent.click(within(credits).getByRole("option", { name: "Desktop agent" }));
    expect(within(credits).getByRole("button", { name: "Usage scope" }).textContent).toContain("Desktop agent");
    const monthBefore = credits.querySelector(".ove-month-name")?.textContent;
    fireEvent.click(within(credits).getByLabelText("Previous month"));
    await settle();
    expect(credits.querySelector(".ove-month-name")?.textContent).not.toBe(monthBefore);
    // Tokens over 31 days.
    expect(within(card("Tokens")).getByText(/At least /)).toBeTruthy();
    // Devices: reach order, every device, Add device.
    const devices = card("Devices");
    expect(within(devices).getByRole("list", { name: "Reach order" })).toBeTruthy();
    for (const n of ["Even G2", "Samuel's iPhone", "Dopl web"]) {
      expect(within(devices).getAllByText(n).length).toBeGreaterThan(0);
    }
    expect(within(devices).getByText("In use")).toBeTruthy();
    expect(within(devices).getByText("64%")).toBeTruthy();
    fireEvent.click(within(devices).getByRole("button", { name: /Add device/ }));
    fireEvent.click(within(devices).getByRole("button", { name: "Glasses" }));
    expect(within(devices).getByLabelText("Pairing code")).toBeTruthy();
    // Channels: credits AND messages per row, plus the untitled fallback.
    const channels = card("Channels");
    expect(within(channels).getByText("#tech-debt")).toBeTruthy();
    expect(within(channels).getByText("1,412")).toBeTruthy();
    expect(within(channels).getByText("2,210")).toBeTruthy();
    expect(within(channels).getByText("Untitled channel")).toBeTruthy();
    // People and tools, and the clipped scan.
    expect(within(card("People")).getByText("Daniel Ortiz")).toBeTruthy();
    expect(within(card("People")).getByText("Unknown member")).toBeTruthy();
    expect(within(card("MCP tools")).getByText(".send_message")).toBeTruthy();
    expect(text()).toContain("From the newest 5,000 events.");
    // Get more credits opens Settings on billing (free plan).
    fireEvent.click(within(credits).getByText("Get more credits"));
    await act(async () => { vi.advanceTimersByTime(100); });
    expect(screen.getAllByText("Plans & Billing").length).toBeGreaterThan(0);
  });

  it("renders each Reads state and each Plan state", async () => {
    await openPage();
    fireEvent.click(screen.getByText("Loading"));
    await settle();
    expect(screen.getByLabelText("Loading Overview").getAttribute("aria-busy")).toBe("true");

    fireEvent.click(screen.getByText("Empty"));
    await settle();
    expect(text()).toContain("No channel activity this month");
    expect(text()).toContain("No tool calls yet");
    expect(text()).toContain("No agent has spent tokens");

    fireEvent.click(screen.getByText("Error"));
    await settle();
    expect(screen.getByRole("alert").textContent).toContain("Could not load Overview.");
    expect(screen.getByText("Try again")).toBeTruthy();

    fireEvent.click(screen.getByText("Data"));
    await settle();
    fireEvent.click(screen.getByText("Pro"));
    await settle();
    expect(within(card("Credits")).queryByText("Get more credits")).toBeNull();
    expect(within(card("Credits")).getByText("2,513")).toBeTruthy();

    fireEvent.click(screen.getAllByText("Out of credits")[0]);
    await settle();
    expect(within(card("Needs you")).getByText("Out of credits")).toBeTruthy();
    expect(within(card("Credits")).getByText("Tool calls are paused until the next period.")).toBeTruthy();
  });

  it("sizes both columns and the pair from the shared height tokens", () => {
    for (const name of ["gap", "cols-h", "needs-h", "agents-h", "credits-h", "tokens-h", "pair-h"]) {
      expect(CSS.match(new RegExp(`--ove-${name}:`, "g"))).toHaveLength(1);
      expect(block(".ove")).toContain(`--ove-${name}:`);
    }
    expect(block(".ove-grid")).toContain("height: var(--ove-cols-h)");
    expect(block('.ove-grid[data-solo="true"]')).toContain("var(--ove-credits-h) + var(--ove-gap) + var(--ove-tokens-h)");
    expect(block(".ove-pair")).toContain("height: var(--ove-pair-h)");
    for (const slot of ["needs", "agents", "credits", "tokens"]) {
      expect(block(`.ove-slot-${slot}`)).toContain(`height: var(--ove-${slot}-h)`);
    }
    expect(block(".ove-col > .ove-card:last-child")).toContain("flex: 1 1 0%");
    const body = block(".ove-card-body");
    expect(body).toContain("overflow-y: auto");
    expect(body).toContain("min-height: 0");
  });

  it("keeps each card's head over its scrolling body, with the skeleton in the same slots", async () => {
    await openPage();
    const preview = layout();
    expect(preview).toEqual({
      solo: null,
      cols: [
        ["ove-slot-needs", "ove-slot-agents", "rest"],
        ["ove-slot-credits", "ove-slot-tokens", "rest"],
      ],
      pair: 2,
      framed: true,
    });
    fireEvent.click(screen.getAllByText("Out of credits")[0]);
    await settle();
    expect(layout()).toEqual(preview);
    expect(card("Needs you").querySelector(".ove-card-body")?.textContent).toContain("Out of credits");

    fireEvent.click(screen.getByText("Loading"));
    await settle();
    expect(layout()).toEqual(preview);

    fireEvent.click(screen.getByText("Off"));
    await settle();
    const solo = layout();
    expect(solo).toEqual({
      solo: "true",
      cols: [["ove-slot-needs"], ["ove-slot-credits", "ove-slot-tokens"]],
      pair: 2,
      framed: true,
    });
    fireEvent.click(screen.getByText("Data"));
    await settle();
    expect(layout()).toEqual(solo);
  });
});

const CSS = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "overview.css"), "utf8");

/** One top-level rule's declarations, by its exact selector. */
function block(selector: string): string {
  const at = CSS.indexOf(`\n${selector} {`);
  return at < 0 ? "" : CSS.slice(at, CSS.indexOf("}", at));
}

/** The two-column section and the pair as slots, and whether every card is head + body. */
function layout() {
  const grid = document.querySelector(".ove-grid");
  const slot = (el: Element) => [...el.classList].find((c) => c.startsWith("ove-slot-")) ?? "rest";
  const cards = [...document.querySelectorAll(".ove-grid .ove-card, .ove-pair .ove-card")];
  return {
    solo: grid?.getAttribute("data-solo") ?? null,
    cols: [...(grid?.children ?? [])].map((col) => [...col.children].map(slot)),
    pair: document.querySelector(".ove-pair")?.children.length ?? 0,
    framed: cards.every(
      (c) =>
        c.children.length === 2 &&
        c.children[0]?.classList.contains("ove-card-head") &&
        c.children[1]?.classList.contains("ove-card-body")
    ),
  };
}
