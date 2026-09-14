/**
 * INVARIANT SUITE — `credits-unmetered.ts`, the web side of "a charge that was
 * not measured says so".
 *
 * 🔒 **THE BEHAVIOUR UNDER TEST IS THE DEDUPE, NOT THE MESSAGE.** The superseded
 * consume route `console.error`'d PER CALL, so the deploy-ordering outage this
 * module exists for (a `PGRST202` between a web deploy and its migration
 * applying) printed one line per tool call per agent and buried itself. The
 * three things that must hold: the FIRST occurrence logs, every later one is
 * SILENT, and the timestamp is the FIRST one rather than the latest.
 *
 * ⚠ The state is PROCESS-LOCAL by decision (the module header carries the full
 * argument), which is exactly why `resetUnmeteredForTests` has to exist: a
 * once-per-process Set cannot be asserted twice without it.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  clearUnmetered,
  recordUnmetered,
  resetUnmeteredForTests,
  unmeteredSince,
} from "./credits-unmetered";

let error: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  resetUnmeteredForTests();
  error = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  error.mockRestore();
  resetUnmeteredForTests();
});

describe("recordUnmetered", () => {
  it("starts silent — nothing is unmetered until something fails open", () => {
    expect(unmeteredSince()).toBeNull();
    expect(error).not.toHaveBeenCalled();
  });

  it("🔒 logs ONCE PER PROCESS PER REASON, however many calls fail", () => {
    for (let i = 0; i < 50; i++) {
      recordUnmetered("consume_failed", `call ${i}`);
    }
    expect(error).toHaveBeenCalledTimes(1);
    // ⚠ THE LINE SAYS THE CONDITION MAY BE CONTINUING. Without that, one line
    // for a three-hour outage reads as one blip three hours ago.
    expect(String(error.mock.calls[0]?.[0])).toContain("ONCE per process");
    expect(String(error.mock.calls[0]?.[0])).toContain("UNMETERED");
  });

  it("carries the caller's detail into the one line it prints", () => {
    recordUnmetered("consume_failed", "workspace ws-1: PGRST202");
    expect(String(error.mock.calls[0]?.[0])).toContain(
      "workspace ws-1: PGRST202"
    );
  });

  it("🔒 stamps the FIRST fail-open, not the latest", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-09-14T10:00:00.000Z"));
      recordUnmetered("consume_failed", "first");
      vi.setSystemTime(new Date("2026-09-14T13:00:00.000Z"));
      recordUnmetered("consume_failed", "three hours later");
      // ⚠ An operator needs HOW LONG the estate has been running free.
      // Re-stamping would answer "a moment ago" for an outage three hours old.
      expect(unmeteredSince()).toBe("2026-09-14T10:00:00.000Z");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("clearUnmetered", () => {
  it("takes the stamp down — the field is what recovers", () => {
    recordUnmetered("consume_failed", "boom");
    expect(unmeteredSince()).not.toBeNull();
    clearUnmetered();
    expect(unmeteredSince()).toBeNull();
  });

  it("🔒 does NOT re-arm the log — a flapping condition is still one line", () => {
    recordUnmetered("consume_failed", "boom");
    clearUnmetered();
    recordUnmetered("consume_failed", "boom again");
    // The FIELD comes back (there is something to show again) …
    expect(unmeteredSince()).not.toBeNull();
    // … and the LOG does not, which is the whole point of the dedupe: a
    // condition that flaps would otherwise print the per-call log this
    // replaced, one line per flap.
    expect(error).toHaveBeenCalledTimes(1);
  });
});
