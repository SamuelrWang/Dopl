// @vitest-environment jsdom
/**
 * The hero scene is deterministic given ONE clock, and is not given two. Both
 * halves are asserted, and the second is the point.
 *
 * Under one frozen clock the server HTML hydrates with zero recoverable errors
 * (case 1). What breaks it is that the fixture's anchor is `Date.now()` at module
 * scope while the server and client bundles are separate module instances
 * evaluated seconds apart, so a row's `h:mm` can differ between renders — case 2
 * reproduces that with a 61-second skew and asserts it still fails.
 *
 * Case 2 is not a bug waiting to be fixed: it is the measurement that justifies
 * `hero-banner.tsx`'s `ssr: false` boundary, and it would still fail with a frozen
 * anchor because `shared/lib/format-time.ts › formatChannelTimestamp` reads the
 * runtime's time zone and its own `new Date()`. The fix is the boundary, not a
 * fork of the formatter.
 *
 * `vi.resetModules()` between the two renders is what makes this a real test:
 * without it both read one module instance and one anchor, so even case 2 passes.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { renderToString } from "react-dom/server";
import { hydrateRoot } from "react-dom/client";

/** One fixed instant, so neither render reads the wall clock by accident. */
const FROZEN = new Date("2026-09-17T09:24:00.000Z");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(FROZEN);
});
afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
});

/**
 * Render the scene to HTML, hydrate a SECOND module instance over it, and report
 * every error React recovered from.
 *
 * The real mechanism, not a string diff: `renderToString`'s output and `innerHTML`
 * differ in attribute order and self-closing syntax by construction, so comparing
 * strings reports mismatches React is happy with. `onRecoverableError` is what the
 * browser console actually prints.
 *
 * @param skewMs advance the clock before the CLIENT module evaluates — the real
 *   gap between a server render and the browser running its own bundle.
 */
async function hydrationErrors(skewMs: number): Promise<string[]> {
  vi.resetModules();
  const server = await import("./demo-scene");
  const { stepIndex } = await import("./demo-steps");
  const step = stepIndex("hold");
  const html = renderToString(<server.DemoScene step={step} />);

  const host = document.createElement("div");
  host.innerHTML = html;
  document.body.appendChild(host);

  vi.setSystemTime(new Date(FROZEN.getTime() + skewMs));
  vi.resetModules();
  const client = await import("./demo-scene");

  const errors: string[] = [];
  await act(async () => {
    hydrateRoot(host, <client.DemoScene step={step} />, {
      onRecoverableError: (error) => errors.push(String(error)),
    });
  });
  return errors;
}

describe("the hero scene's first paint", () => {
  it("🔒 hydrates with no recoverable error when both renders share a clock", async () => {
    const errors = await hydrationErrors(0);
    // Names them — a count says nothing about which node diverged.
    expect(errors).toEqual([]);
  });

  it("🔒 …and the SCENE is what is deterministic, not an empty render", async () => {
    // A tree that rendered nothing would pass the case above vacuously.
    vi.resetModules();
    const { DemoScene } = await import("./demo-scene");
    const { stepIndex } = await import("./demo-steps");
    const html = renderToString(<DemoScene step={stepIndex("hold")} />);
    expect(html.length).toBeGreaterThan(5000);
    // The row whose timestamp is the thing that diverges in case 2.
    expect(html).toContain("q4-outbound");
  });

  it("🚫 a clock that moved between the two module evaluations still fails", async () => {
    // The measurement behind `hero-banner.tsx`'s `ssr: false`: 61s is the
    // smallest skew that can move a row off its printed `h:mm`, and a realistic
    // gap between a server render and the browser evaluating its own bundle.
    const errors = await hydrationErrors(61_000);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.join(" ")).toMatch(/[Hh]ydration/);
  });
});
