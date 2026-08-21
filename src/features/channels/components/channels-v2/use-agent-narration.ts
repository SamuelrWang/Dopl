"use client";

/**
 * THE WORK LANE'S DATA — what one of my agents has been doing (2026-08-20, F-212).
 *
 * ⚠ THE SHAPE IS `agents-model.ts › useDesktopSessions`'s, deliberately: READ ONCE ON
 * MOUNT, THEN LISTEN. A push-only surface leaves a freshly opened window blank until the
 * next event, and an agent between turns produces none — which is exactly the state a
 * window is most often opened in.
 *
 * ⚠ `null` = COULD NOT ASK (a plain browser, or a main without the ops); `[]` = asked, it
 * has said nothing yet. Never collapse one into the other (INVARIANTS §11 — UNKNOWN is not
 * EMPTY): the window words them differently, because "this build cannot show you the work"
 * and "your agent has not done anything yet" are different facts.
 *
 * ⚠ FRAMES ARE KEYED BY `sessionKey` AND FILTERED HERE. Main pushes each dirty session's
 * ring to every registered app window and tracks no subscriptions — a subscription
 * protocol's only failure mode is the two sides going out of step, and there is nothing to
 * gain from it when the filter is a string compare.
 */

import { useEffect, useState, useSyncExternalStore } from "react";
import { getSpaBridge } from "@/shared/lib/spa-bridge";

/** One line of what an agent did. The closed `kind` vocabulary is
 *  `dopl-desktop-app/main/session-narration.js › entryFor`'s. */
export interface AgentNarrationEntry {
  /** Epoch ms. */
  at: number;
  kind: "assistant" | "tool" | "result" | "post" | "status";
  /** Present on `tool` and `result` — what joins a result to the call it answers. */
  toolUseId?: string;
  /** The RAW tool name on a `tool` entry. ⚠ Shortened at RENDER time, through the same
   *  helper the pill's detail uses, so one call is not named two ways on one screen. */
  tool?: string;
  /** `false` only on a `result` that failed. */
  ok?: boolean;
  text?: string;
}

export interface AgentNarrationFeed {
  entries: AgentNarrationEntry[] | null;
  /** Whether this build can show the lane at all — drives the window's empty wording. */
  supported: boolean;
}

/** The (channel, thread) key main rings on. ⚠ The SAME composition
 *  `main/session-store.js › sessionKey` makes; it is carried, never re-derived from parts
 *  the renderer happens to hold. */
function narrationKey(channelId: string, taskId: string): string {
  return `${channelId}:${taskId}`;
}

/**
 * ⚠ THE CAPABILITY IS READ WITH `useSyncExternalStore`, NOT SET IN AN EFFECT — the shape
 * `pop-out.tsx` established for exactly this, and INVARIANTS §11 records the reason: the
 * bridge is a WINDOW GLOBAL, so a render-time read makes the server and the first client
 * render disagree, and a synchronous `setState` inside an effect is a
 * `react-hooks/set-state-in-effect` ERROR in this tree rather than a preference. A
 * preload's surface is fixed for the life of the document, so there is nothing to
 * subscribe to; the server snapshot is `false` because no bridge exists there.
 */
const noSubscribe = () => () => {};
const hasNarration = () => {
  const sessions = getSpaBridge()?.sessions;
  return (
    typeof sessions?.narration === "function" &&
    typeof sessions?.onNarration === "function"
  );
};
const noBridgeOnServer = () => false;

export function useAgentNarration(
  channelId: string,
  taskId: string
): AgentNarrationFeed {
  const [entries, setEntries] = useState<AgentNarrationEntry[] | null>(null);
  const supported = useSyncExternalStore(noSubscribe, hasNarration, noBridgeOnServer);

  useEffect(() => {
    const sessions = getSpaBridge()?.sessions;
    const canRead = typeof sessions?.narration === "function";
    const canListen = typeof sessions?.onNarration === "function";
    if (!canRead || !canListen) return;
    const key = narrationKey(channelId, taskId);
    let live = true;

    void sessions
      .narration?.(channelId, taskId)
      .then((r) => {
        // The subscription below may already have delivered a NEWER frame while this read
        // was in flight; it must not be overwritten by the older one.
        if (live) setEntries((prev) => prev ?? r.entries);
      })
      .catch(() => {
        if (live) setEntries((prev) => prev ?? []);
      });

    const off = sessions.onNarration?.((e) => {
      if (!live || e.sessionKey !== key) return;
      setEntries(e.entries);
    });
    return () => {
      live = false;
      off?.();
    };
  }, [channelId, taskId]);

  return { entries, supported };
}
