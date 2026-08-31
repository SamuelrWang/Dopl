"use client";

import { useEffect, useRef, useState } from "react";
import { apiRequest } from "@/shared/api/api-client";

const POLL_INTERVAL_MS = 3500;
/**
 * Backoff ceiling for a poll that keeps FAILING. ⚠ Not a tuning knob — it is the
 * bound. See the incident note on the scheduler below.
 */
const POLL_MAX_INTERVAL_MS = 60_000;

/**
 * Delay after `consecutiveFailures` back-to-back failures: 3.5s doubling to 60s.
 * ⚠ The FIRST failure keeps today's 3.5s — a one-off blip must still recover at the old
 * speed, and only a pattern earns a slower rate. Same convention as
 * `dopl-desktop-app/main/listener-heal.js › listRetryDelay`.
 */
function backoffMs(consecutiveFailures: number): number {
  if (consecutiveFailures <= 0) return POLL_INTERVAL_MS;
  return Math.min(
    POLL_MAX_INTERVAL_MS,
    POLL_INTERVAL_MS * 2 ** Math.min(consecutiveFailures - 1, 10)
  );
}

/**
 * Poll GET /api/onboarding/mcp-status until the signed-in user has an active
 * MCP OAuth token. Self-stops on connect/unmount; `enabled` pauses it on skip.
 *
 * ⚠ `apiRequest`, not `fetch` — packaged desktop renderer ships
 * `connect-src 'none'` and rides the IPC transport. Route is `force-dynamic`
 * with no cache-control, so no `cache: "no-store"` is needed.
 *
 * ⚠ SELF-SCHEDULING, NOT `setInterval` (2026-08-30, the desktop abort-churn incident).
 * A fixed 3.5s interval fires whether or not the previous request has settled, and on
 * the desktop this rides an IPC transport whose main-process timeout is 30s — so a slow
 * or saturated API put ~9 doomed requests in flight AT ONCE, per window, forever, each
 * holding a socket in main until it aborted. A cadence shorter than the request timeout
 * with no in-flight guard is not a poll, it is an amplifier: the sicker the server, the
 * more load it gets. Chaining the next timer off the SETTLEMENT makes the effective
 * period `max(interval, request duration)` and caps the in-flight count at one.
 *
 * ⚠ AND IT BACKS OFF. An in-flight guard alone still hammers a server that fails FAST
 * (a 401 storm answers instantly), so consecutive failures double the delay to a 60s
 * ceiling; the first success resets it. A poll with no give-back is how a recoverable
 * outage stays an outage.
 */
export function useMcpConnectionPoll(enabled: boolean): boolean {
  const [connected, setConnected] = useState(false);
  const connectedRef = useRef(false);

  useEffect(() => {
    if (!enabled || connectedRef.current) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;

    async function check() {
      try {
        const body = await apiRequest<{ connected?: boolean }>(
          "/api/onboarding/mcp-status"
        );
        failures = 0;
        if (body.connected && !cancelled) {
          connectedRef.current = true;
          setConnected(true);
        }
      } catch {
        // Transient failure — the next tick retries, further out each time.
        failures += 1;
      }
    }

    // ⚠ Scheduled from the PREVIOUS attempt's settlement, so `check()` can never
    // overlap itself and a hung request simply delays the next one.
    const run = async () => {
      await check();
      if (cancelled || connectedRef.current) return;
      timer = setTimeout(run, backoffMs(failures));
    };
    void run();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [enabled]);

  return connected;
}
