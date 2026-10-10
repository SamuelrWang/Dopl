"use client";

import { getSpaBridge } from "@/shared/lib/spa-bridge";

/**
 * POKING THE DESKTOP'S BANNER GATE (2026-10-09). The preferences themselves are the ACCOUNT's and
 * the panel writes them over `/api/user/notification-preferences` — this file moves no value.
 *
 * What it is for: the desktop's gate (`main/notification-prefs.js`) is a SYNCHRONOUS call on the
 * listener's drain path, so it answers from a short-lived cache of that record. Without this poke a
 * switch flipped here would keep banners for up to a minute after the operator turned them off,
 * which reads as the setting not working.
 *
 * ⚠ BEST EFFORT, AND NOT PART OF SAVING. The save has already succeeded when this runs; on the
 * web, on an older main with no such op, or on a refusal there is nothing to report and nothing to
 * revert — the gate re-reads on its own TTL anyway.
 * ⚠ CAPABILITY-KEYED, never truthiness: a main older than the op has a `window.dopl` with
 * everything but it (the `use-orchestrator-launch.ts` rule).
 */
export function refreshDesktopBannerGate(): void {
  const bridge = getSpaBridge()?.notifications;
  if (!bridge || typeof bridge.refresh !== "function") return;
  try {
    void Promise.resolve(bridge.refresh()).catch(() => {});
  } catch {
    /* an op that throws synchronously is still just a stale cache */
  }
}
