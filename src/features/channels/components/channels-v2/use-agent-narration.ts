"use client";

/**
 * THE WORK LANE'S DATA — what one of my agents has been doing (2026-08-20, F-212).
 *
 * ⚠ THE SHAPE IS `use-desktop-sessions.ts › useDesktopSessions`'s, deliberately: READ ONCE ON
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
 * gain from it when the filter is a string compare. ⚠ THAT KEY HAS THREE SEGMENTS since
 * multiplayer agents (`<channelId>:<taskId>:<agentId>`); see {@link narrationPrefix} for
 * what a two-segment filter cost.
 */

import { useEffect, useState, useSyncExternalStore } from "react";
import { getSpaBridge, type DesktopNarrationEntry } from "@/shared/lib/spa-bridge";

/**
 * One line of what an agent did.
 *
 * ⚠ IT IS THE BRIDGE'S TYPE, NOT A SECOND COPY OF IT (2026-08-22). This was a hand-written
 * interface whose `kind` union restated `spa-bridge.ts › DesktopNarrationEntry`'s — and when
 * main's vocabulary gained `thinking` / `private-in` / `private-reply` the two disagreed, which
 * is a compile error here and would have been a silently dropped line if the copy had been
 * looser instead of narrower. The vocabulary is `dopl-desktop-app/main/session-narration.js ›
 * entryFor`'s; there is now ONE declaration of it in this tree and this is an alias onto it, so
 * every existing importer of the name is unchanged.
 *
 * ⚠ RENDER AN UNKNOWN KIND AS NOTHING. A main newer than this build can emit a member this
 * union does not list, and a mystery bubble in a work lane is worse than a missing one.
 */
export type AgentNarrationEntry = DesktopNarrationEntry;

export interface AgentNarrationFeed {
  entries: AgentNarrationEntry[] | null;
  /** Whether this build can show the lane at all — drives the window's empty wording. */
  supported: boolean;
}

/**
 * THE (channel, thread, AGENT) KEY MAIN RINGS ON — three segments, not two
 * (2026-08-22, F-250).
 *
 * ⚠ THE SAME COMPOSITION `main/session-store.js › sessionKey` MAKES:
 * `<channelId>:<taskId>:<agentId>`. It gained its third segment with multiplayer
 * agents, and this side did not — so every pushed frame's `sessionKey` failed the
 * equality below and the Work lane FROZE at whatever the mount read returned, on
 * every build, single-agent included. A filter that can never match has no error
 * shape: the window renders, the header stays live off the summaries feed, and
 * only the lane that is the whole point of the window stops.
 *
 * ⚠ THE TRAILING COLON ON THE PREFIX IS LOAD-BEARING, the same way
 * `session-store.js › threadKeyPrefix` says it is: without it `<channel>:<thread>`
 * would also prefix `<channel>:<thread-with-a-longer-id>`.
 */
function narrationPrefix(channelId: string, taskId: string): string {
  return `${channelId}:${taskId}:`;
}

/**
 * DOES THIS PUSHED FRAME BELONG TO THE AGENT ON SCREEN.
 *
 * ⚠ WITH AN ID IT IS AN EXACT COMPARE — the whole reason the id is threaded here.
 * WITHOUT one (a main that predates `agentId` on the summaries feed) it falls
 * back to the (channel, thread) PREFIX, which is the honest degradation: such a
 * main runs at most one agent per thread, so the prefix names exactly that agent.
 * It is deliberately NOT a refusal — a dead lane is strictly worse than a lane
 * that is exact on every build that can be exact.
 */
function narrationMatches(
  sessionKey: string,
  channelId: string,
  taskId: string,
  agentId: string
): boolean {
  const prefix = narrationPrefix(channelId, taskId);
  return agentId ? sessionKey === prefix + agentId : sessionKey.startsWith(prefix);
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

/**
 * ⚠ THE RING IS HELD UNDER THE KEY IT WAS ASKED FOR, not as a bare array
 * (2026-08-22, F-250). The window resolves its agent ASYNCHRONOUSLY — `sessions`
 * is `null` for the first frames — so this hook is mounted with no `agentId` and
 * gains one a tick later. A bare array would keep the FIRST answer (`prev ??`)
 * and the exact read that followed would be discarded, which is the same frozen
 * lane by another route. Storing the key beside the ring makes a stale answer
 * simply not match, with no `setState` in an effect to reset it —
 * `react-hooks/set-state-in-effect` is an ERROR in this tree, not a preference.
 */
interface NarrationFrame {
  key: string;
  entries: AgentNarrationEntry[];
}

export function useAgentNarration(
  channelId: string,
  taskId: string,
  /** WHICH INSTANCE. ⚠ Optional: a main older than multiplayer emits no `agentId`
   *  on its summaries and runs at most one agent per thread, so its absence
   *  degrades to the (channel, thread) prefix rather than refusing. */
  agentId?: string | null
): AgentNarrationFeed {
  const [frame, setFrame] = useState<NarrationFrame | null>(null);
  const supported = useSyncExternalStore(noSubscribe, hasNarration, noBridgeOnServer);
  const agent = typeof agentId === "string" ? agentId.trim() : "";
  const key = narrationPrefix(channelId, taskId) + agent;

  useEffect(() => {
    const sessions = getSpaBridge()?.sessions;
    const canRead = typeof sessions?.narration === "function";
    const canListen = typeof sessions?.onNarration === "function";
    if (!canRead || !canListen) return;
    let live = true;

    void sessions
      // ⚠ THE THIRD ARGUMENT NAMES THE INSTANCE. Main resolves the read against
      // its own registry by the blended (channel, thread, agent) slot
      // (`session-store.js › slotKey`), so without it the mount read lands on
      // the thread's OLDEST live agent rather than the one on screen. It is
      // optional on the bridge and an older preload drops it, which is exactly
      // the behaviour that build already had.
      .narration?.(channelId, taskId, agent || undefined)
      .then((r) => {
        // The subscription below may already have delivered a NEWER frame while this read
        // was in flight; it must not be overwritten by the older one.
        if (live) setFrame((prev) => (prev?.key === key ? prev : { key, entries: r.entries }));
      })
      .catch(() => {
        if (live) setFrame((prev) => (prev?.key === key ? prev : { key, entries: [] }));
      });

    const off = sessions.onNarration?.((e) => {
      if (!live || !narrationMatches(e.sessionKey, channelId, taskId, agent)) return;
      setFrame({ key, entries: e.entries });
    });
    return () => {
      live = false;
      off?.();
    };
  }, [channelId, taskId, agent, key]);

  return { entries: frame?.key === key ? frame.entries : null, supported };
}
