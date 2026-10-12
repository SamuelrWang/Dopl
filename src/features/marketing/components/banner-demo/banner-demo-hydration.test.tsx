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

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { renderToString } from "react-dom/server";
import { hydrateRoot } from "react-dom/client";
import { CHANNEL_NAME } from "./demo-data";

/** One fixed instant, so neither render reads the wall clock by accident. */
const FROZEN = new Date("2026-09-17T09:24:00.000Z");

/**
 * 🔴 **THE FIRST CASE USED TO CARRY THIS FILE'S ONE-TIME MODULE COST, AND THAT IS WHAT
 * MADE IT FLAKE 1 IN 4 UNDER PARALLEL LOAD** (reviewer, 2026-10-12).
 *
 * ⚠ **THE FLAKE WAS NEVER THE HYDRATION MECHANISM. IT WAS A TIMEOUT.** `hydrationErrors`
 * calls `vi.resetModules()` and re-imports `demo-scene`, which pulls the product's whole
 * channels component tree — twice per call. Unloaded, case 1 measured **1720-2336ms**
 * against **51-248ms** for its two siblings, because whichever case ran first absorbed
 * the transform and resolve work for that graph. Vitest's default `testTimeout` is
 * 5000ms, so case 1 sat about 2x from the limit and crossed it whenever it shared a
 * worker window with other heavy files. It then died as a TIMEOUT at ~5.1s, which reads
 * in the log exactly like a hydration failure and is not one.
 *
 * ⚠ **SO THE COST MOVES HERE, WHERE IT GETS ITS OWN TIMEOUT INSTEAD OF EATING A TEST'S.**
 * After this, case 1 measures ~274ms and nothing in the file sits near the limit.
 * Raising `testTimeout` would have hidden the cliff while leaving it in place, and
 * `--no-file-parallelism` only avoids it per run.
 *
 * ⚠ **IT CANNOT CONTAMINATE WHAT THE FILE MEASURES, AND THAT IS THE ONLY REAL RISK.**
 * This import evaluates `demo-data`'s module-scope `Date.now()` anchor under REAL time,
 * before `beforeEach` installs the fake clock. That instance is then thrown away:
 * `hydrationErrors` begins with `vi.resetModules()`, so both renders it compares are
 * fresh evaluations under the frozen clock. What is warm is Vite's transform and resolve
 * cache, which holds no anchor. The `resetModules()` that makes this test real
 * (see the file docblock) is the same thing that makes the warm-up safe.
 */
beforeAll(async () => {
  await import("./demo-scene");
  await import("./demo-steps");
}, 30_000);

/** Nothing warm may leak into another file's registry. */
afterAll(() => {
  vi.resetModules();
});

/**
 * **AND A BUDGET, BECAUSE THE WARM-UP ALONE ONLY MADE THE FLAKE RARER.**
 *
 * ⚠ **MEASURED, NOT ASSUMED.** With the warm-up and the default 5000ms budget, the full
 * marketing directory under default parallelism failed **once in 44 runs** on a loaded
 * machine — down from the reviewer's 1 in 4, but the same case and therefore the same
 * class, not a fixed bug. Nominal is ~370ms, so a failure needs a ~13x overshoot, which
 * is what severe contention does on a box running several worktrees at once.
 *
 * ⚠ **THIS IS NOT MASKING, AND THE DISTINCTION IS WORTH BEING EXACT ABOUT.** What this
 * file asserts is `errors === []` — a FACT ABOUT THE RENDER, with no timing component.
 * Its wall time is spent on two evaluations of the product's component tree and a
 * hydration pass, none of which is under assertion. A budget that survives a loaded
 * machine therefore weakens nothing; it stops a slow machine from being REPORTED as a
 * hydration bug, which is the only thing that was ever wrong here.
 *
 * ⚠ **IT STILL FAILS IF HYDRATION GENUINELY HANGS**, in bounded time, which is the one
 * thing a timeout must not give up. 20s is ~54x nominal: far past any contention this
 * repo's suite produces, nowhere near "never".
 */
const BUDGET_MS = 20_000;

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
  }, BUDGET_MS);

  it("🔒 …and the SCENE is what is deterministic, not an empty render", async () => {
    // A tree that rendered nothing would pass the case above vacuously.
    vi.resetModules();
    const { DemoScene } = await import("./demo-scene");
    const { stepIndex } = await import("./demo-steps");
    const html = renderToString(<DemoScene step={stepIndex("hold")} />);
    expect(html.length).toBeGreaterThan(5000);
    // The row whose timestamp is the thing that diverges in case 2.
    expect(html).toContain(CHANNEL_NAME);
  }, BUDGET_MS);

  it("🚫 a clock that moved between the two module evaluations still fails", async () => {
    // The measurement behind `hero-banner.tsx`'s `ssr: false`: 61s is the
    // smallest skew that can move a row off its printed `h:mm`, and a realistic
    // gap between a server render and the browser evaluating its own bundle.
    const errors = await hydrationErrors(61_000);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.join(" ")).toMatch(/[Hh]ydration/);
  }, BUDGET_MS);
});
