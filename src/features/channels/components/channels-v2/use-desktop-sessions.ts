"use client";

/**
 * THE DESKTOP'S SESSION FEED — this machine's live registry of MY agents, and the
 * one subscription every agent surface reads from.
 *
 * ⚠ SPLIT OUT OF `agents-model.ts` ON 2026-08-22, at the 500-line cap, on the seam
 * §1 names: **this file is the only STATEFUL thing in that family.** It holds a
 * React subscription, a bounded window-global probe and an imperative re-read —
 * machinery that changes when the BRIDGE's delivery shape changes. What stays in
 * `agents-model.ts` is pure: slicing and labelling a list somebody else fetched,
 * which changes when the PRODUCT's questions change. Two rates of change, two
 * files.
 *
 * ⚠ THE SOURCE IS LOCAL RUNTIME STATE, NOT A TABLE (INVARIANTS §5).
 * `spa-bridge.ts › DesktopSessionSummary` over `sessions.summaries` /
 * `sessions.onSummaries`, projected by `dopl-desktop-app/main/session-summary.js`.
 * The server stores none of it: `session-state-push.js › rowFor` picks the
 * `channel_sessions` columns by name and takes no metric.
 *
 * ⚠ DESKTOP-ONLY, AND SILENT-BUT-NOT-BLANK WITHOUT IT. `null` means "could not
 * ask" — a plain browser, or a desktop older than the feed — and is a DIFFERENT
 * fact from `[]`, which means "asked, nothing is running". Every consumer words
 * the two differently and none may collapse one into the other (INVARIANTS §11 —
 * UNKNOWN is not EMPTY). Detection is CAPABILITY-KEYED (`typeof … === "function"`),
 * never a shell name and never a truthy `window.dopl`.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { getSpaBridge, type DesktopSessionSummary } from "@/shared/lib/spa-bridge";

/**
 * The desktop's session feed, plus the one imperative way to re-read it.
 *
 * ⚠ `refresh` EXISTS FOR THE REFUSAL PATH AND NOTHING ELSE. The feed is a PUSH
 * and stays one: main dispatches, the projection moves, the push re-renders.
 * The single case a push cannot cover is a control main REFUSED — the operator
 * pressed Pause on an agent whose registry entry was already gone, so nothing
 * changed on that side and nothing will be pushed. Re-reading is how the panel
 * stops showing a live-looking agent that is not there. It is NOT a poll and
 * must not become one.
 */
export interface DesktopSessionsFeed {
  /** `null` = could not ask; `[]` = asked, nothing is running. Never collapse
   *  one into the other (INVARIANTS §11 — UNKNOWN is not EMPTY). */
  sessions: DesktopSessionSummary[] | null;
  refresh: () => void;
}

/**
 * Subscribe to the desktop's own session feed.
 *
 * `null` = no bridge, or a main without the feed. `[]` = a bridge with nothing
 * running. AFTER MOUNT, NEVER DURING RENDER: the bridge is a window global, so
 * reading it while rendering makes the server and the first client render
 * disagree — the subscription effect is the only place it is read.
 */
/** Re-probes for the preload global before settling on "could not ask". Five
 *  tries at 200ms is one second — long enough for a slow first paint, short
 *  enough that a plain browser reaches its honest `null` inside a blink. */
const BRIDGE_PROBE_LIMIT = 5;
const BRIDGE_PROBE_MS = 200;

export function useDesktopSessions(): DesktopSessionsFeed {
  const [summaries, setSummaries] = useState<DesktopSessionSummary[] | null>(null);
  const [probe, setProbe] = useState(0);
  // ONE mounted flag for the imperative re-read. The subscription below keeps
  // its own `live` local because it is scoped to a single effect run; a
  // refresh fired from a click has no effect to be scoped to, and an answer
  // that lands after unmount must not set state.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const refresh = useCallback(() => {
    const sessions = getSpaBridge()?.sessions;
    if (typeof sessions?.summaries !== "function") return;
    void sessions
      .summaries()
      .then((r) => {
        if (mounted.current) setSummaries(r.sessions);
      })
      // A failed re-read leaves the last pushed frame standing. It is strictly
      // less wrong than replacing a real feed with "could not ask".
      .catch(() => {});
  }, []);

  useEffect(() => {
    const sessions = getSpaBridge()?.sessions;
    // Both members are optional on the interface: an older main has `reopen` and
    // neither of these, and must degrade to "could not ask" rather than to a
    // broken call.
    const canRead = typeof sessions?.summaries === "function";
    const canListen = typeof sessions?.onSummaries === "function";
    // ⚠ A BOUNDED RE-PROBE, ADDED 2026-08-20 — the effect used to run ONCE on
    // `[]` deps, so a first mount that raced the preload's global left the feed
    // permanently `null` and the Agents tab permanently said "could not ask".
    // BOUNDED on purpose: `null` is the CORRECT terminal answer for a plain
    // browser and for a main without the feed (INVARIANTS §11 — UNKNOWN is not
    // EMPTY), so this must converge on it rather than poll for a bridge that is
    // never coming. It is not a data poll — it re-probes a window global and
    // stops.
    if (!canRead || !canListen) {
      if (probe >= BRIDGE_PROBE_LIMIT) return;
      const timer = setTimeout(() => setProbe((n) => n + 1), BRIDGE_PROBE_MS);
      return () => clearTimeout(timer);
    }

    let live = true;
    // READ ONCE, THEN LISTEN. The feed is a push, and a push-only surface leaves
    // a freshly opened channel blank until the next state change — which on a
    // quiet machine never comes.
    void sessions
      .summaries?.()
      .then((r) => {
        // The subscription below may already have delivered a NEWER frame while
        // this read was in flight; it must not be overwritten by the older one.
        if (live) setSummaries((prev) => prev ?? r.sessions);
      })
      .catch(() => {
        if (live) setSummaries((prev) => prev ?? []);
      });

    const off = sessions?.onSummaries?.((e) => {
      if (live) setSummaries(e.sessions);
    });
    return () => {
      live = false;
      off?.();
    };
  }, [probe]);

  return { sessions: summaries, refresh };
}