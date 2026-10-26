// @vitest-environment jsdom
/**
 * The demo's top bar and channel switcher (`demo-home-faces.tsx`): same items, same
 * order, same marks. The composer's working chips are the product's own.
 */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { HOME_TABS } from "@/features/home/tabs";
import { HOME_CHANNEL_WELLS } from "@/features/channels/components/home-channel-wells";
import { DemoScene } from "./demo-scene";
import { stepIndex } from "./demo-steps";
import { HOME_ROW_ID, homeRowsAt } from "./demo-home-rows";

afterEach(cleanup);

const HOLD = stepIndex("hold");

describe("the demo top bar", () => {
  it("keeps every control: New channel, the five tabs on Channel, Search, Profile", () => {
    const { container } = render(<DemoScene step={HOLD} />);
    const bar = container.querySelector(".lp-demo-top")!;
    expect(bar.textContent).toContain("New channel");
    expect(bar.textContent).toContain("Search…");
    expect(bar.querySelector('[title="Profile"]')).not.toBeNull();
    const tabs = [...bar.querySelectorAll(".lp-demo-top-tab")];
    expect(tabs.map((t) => t.textContent)).toEqual(HOME_TABS.map((t) => t.label));
    expect(bar.querySelector('[data-selected="true"]')?.textContent).toBe("Channel");
  });
});

describe("the demo channel switcher", () => {
  it("draws every well and the open wells' rows in order, the live one selected", () => {
    const { container } = render(<DemoScene step={HOLD} />);
    const heads = [...container.querySelectorAll(".lp-demo-sw-head")].map(
      (h) => h.textContent
    );
    expect(heads).toEqual(HOME_CHANNEL_WELLS.map((w) => w.label));
    const open = new Set(
      HOME_CHANNEL_WELLS.filter((w) => w.defaultOpen).map((w) => w.id as string)
    );
    const expected = homeRowsAt(HOLD)
      .filter((r) => open.has(r.well))
      .map((r) => r.name);
    const names = [...container.querySelectorAll(".lp-demo-sw-name")].map(
      (n) => n.textContent
    );
    expect(names).toEqual(expected);
    const live = homeRowsAt(HOLD).find((r) => r.id === HOME_ROW_ID)!;
    expect(
      container.querySelector('.lp-demo-sw-row[data-selected="true"] .lp-demo-sw-name')
        ?.textContent
    ).toBe(live.name);
    expect(container.querySelector('[title="2 unread mentions"]')).not.toBeNull();
    expect(container.textContent).toContain("Invited");
  });
});

describe("the composer's working chips", () => {
  it("are the product's own pills", () => {
    const { container } = render(<DemoScene step={HOLD} />);
    const chips = [...container.querySelectorAll('[aria-label="Recipients"] [role="status"]')];
    expect(chips.length).toBeGreaterThan(0);
    for (const chip of chips) expect(chip.className).toContain("rounded-full");
    expect(chips.map((c) => c.textContent)).toContain("Teardown Order Fix...");
  });
});
