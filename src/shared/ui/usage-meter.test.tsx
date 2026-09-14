// @vitest-environment jsdom

/**
 * 🔒 THE METER NEVER PRINTS A DENOMINATOR IT WAS NOT GIVEN (2026-08-28).
 *
 * ⚠ THE BUG THIS PINS WAS A COLLISION BETWEEN TWO WAVES, AND EACH WAS RIGHT ALONE. The 2026-08-27
 * ruling made the agent surfaces render the BAR unconditionally, at 0, so a spawn-idle agent got a
 * box instead of nothing — `channels-v2/agent-panel.tsx › AgentStats` and
 * `channels-v2/agent-window.tsx › AgentWindowStats` therefore call this with `used ?? 0` and
 * `limit ?? 0`, on the stated grounds that *"`UsageMeter` handles the missing denominator itself"*.
 * It handled it for the ARITHMETIC (`limit > 0 ? … : 0`, an empty track rather than a division) and
 * not for the READOUT, which printed `{fmt(limit)}` regardless.
 *
 * So the reachable case — `contextUsed` reported, `contextWindow` absent, which
 * `channels-v2/agent-metrics.ts › metric` names outright (*"a model this build has no window for
 * has no denominator"*) — rendered **"84k / 0k"** over an empty bar. A fabricated denominator, and
 * an empty track that reads as headroom, for an agent that may be nearly full. That file's own
 * words: *"NONE of them means zero — a context meter reading 0% of a window that is nearly full is
 * a lie the operator acts on."*
 *
 * ⚠ IT PINS BOTH DIRECTIONS, because the fix has an obvious over-correction. Dropping the METER on
 * a missing denominator would re-break the 2026-08-27 ruling; dropping only the DENOMINATOR is the
 * one shape that satisfies both, so the bar's presence is asserted in the same breath as the
 * number's absence.
 */

import { describe, expect, it, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { UsageMeter } from "./usage-meter";

afterEach(cleanup);

/** `84_000` → `"84k"` — `channels-v2/agent-metrics.ts › formatTokens`, restated so this suite does
 *  not reach across features for a formatter it only needs as a sample. */
const tokens = (v: number) => `${Math.round(v / 1000)}k`;

describe("a missing denominator", () => {
  it("shows the number that IS known and no denominator beside it", () => {
    const { container } = render(
      <UsageMeter label="Context tokens" used={84_000} limit={0} tone="ramp" formatValue={tokens} />
    );
    expect(screen.getByText("84k")).toBeTruthy();
    // ⚠ THE WHOLE POINT. `84k / 0k` asserts a window this build was never told.
    expect(container.textContent).not.toContain("0k");
    expect(container.textContent).not.toContain("/");
  });

  it("STILL RENDERS THE BAR, at zero — the 2026-08-27 ruling is not what this fixes", () => {
    const { container } = render(
      <UsageMeter label="Context tokens" used={84_000} limit={0} tone="ramp" formatValue={tokens} />
    );
    const track = container.querySelector(".concave-track");
    expect(track).toBeTruthy();
    expect((track?.firstElementChild as HTMLElement).style.width).toBe("0%");
  });

  it("is not triggered by a real denominator — the ordinary meter is untouched", () => {
    const { container } = render(
      <UsageMeter label="Context tokens" used={84_000} limit={200_000} tone="ramp" formatValue={tokens} />
    );
    expect(screen.getByText("84k / 200k")).toBeTruthy();
    const track = container.querySelector(".concave-track");
    expect((track?.firstElementChild as HTMLElement).style.width).toBe("42%");
  });

  it("covers the spawn-idle case both surfaces actually pass: 0 used, 0 limit", () => {
    // ⚠ `used ?? 0` AND `limit ?? 0` — the literal call `AgentStats` makes before an agent's first
    // turn reports anything. It must be a bar and a bare number, not `0k / 0k`.
    const { container } = render(
      <UsageMeter label="Context tokens" used={0} limit={0} tone="ramp" formatValue={tokens} />
    );
    expect(container.textContent).not.toContain("/");
    expect(container.querySelector(".concave-track")).toBeTruthy();
  });
});

/**
 * 🔒 THE LABEL IS OPTIONAL SINCE 2026-09-13 (the /home Usage card, Samuel:
 * *"remove the credits and the 'Credits used' text"*) — and the READOUT MUST NOT
 * MOVE when it goes. The row is `flex justify-between`; with the label dropped it
 * holds ONE item, and `space-between` parks a lone item at the START — so the
 * `used / limit` pair silently jumped to the LEFT edge of the card while the
 * component's own docblock claimed it "stays where it is, right-aligned above the
 * track". The `ml-auto` on the readout is what makes that claim true, and it is a
 * no-op in the two-child case.
 */
describe("the optional label", () => {
  it("keeps the readout pinned right when there is no label", () => {
    render(<UsageMeter used={120} limit={500} />);
    const readout = screen.getByText("120 / 500");
    expect(readout.parentElement?.children.length).toBe(1);
    expect(readout.className).toContain("ml-auto");
  });

  it("still renders the label when one is given, and the pair still splits", () => {
    render(<UsageMeter label="Storage" used={120} limit={500} />);
    const row = screen.getByText("120 / 500").parentElement;
    expect(row?.children.length).toBe(2);
    expect(row?.className).toContain("justify-between");
    expect(screen.getByText("Storage")).toBeTruthy();
  });
});
