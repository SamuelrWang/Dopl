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
