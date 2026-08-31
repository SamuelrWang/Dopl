"use client";

/**
 * AGENT CHAINING — the DURABLE per-channel setting that lifts the one-generation
 * launch bound (Samuel, 2026-08-31).
 *
 * OFF (the default, and the bound that shipped): an agent this operator launched
 * may not launch further agents — `dopl_channel(op="launch_agent")` from such a
 * session is refused by a BOUND, not by a permission prompt
 * (`main/session-own-launch.js › MAX_LAUNCH_DEPTH`). ON: it may, in this channel.
 *
 * ⚠ IT LIFTS A DEPTH BOUND AND GRANTS NOTHING. A chained launch still needs the
 * `bypass` tool posture, the outbound message half, the machine-wide
 * "Orchestrator launches" toggle, a free session slot, and the rolling
 * per-channel launch budget. With this on and any one of those closed, nothing
 * launches.
 *
 * ⚠ IT APPLIES TO SESSIONS STARTED AFTER THE FLIP, not to running ones, and that
 * is deliberate rather than a lag: the 2026-08-25 live-apply ruling fans a changed
 * POSTURE out to running sessions on an argument that names its own limit — it
 * widens SUPERVISION, never CONTAINMENT — and this is containment.
 *
 * Desktop-only, like the working folder and auto-send: the setting drives the
 * desktop's spawn stamp (`main/channel-prefs.js › getAgentChain`), so a plain
 * browser renders nothing (`bridge` stays null and the row vanishes whole — the
 * no-dead-rows rule).
 */

import { useCallback, useEffect, useState } from "react";

export interface DoplAgentChainBridge {
  getAgentChain: (channelId: string) => Promise<boolean>;
  setAgentChain: (
    channelId: string,
    on: boolean
  ) => Promise<{ ok: boolean; on?: boolean }>;
}

/** The bridge inside the desktop shell with the chaining API, else null. */
function getDesktopAgentChain(): DoplAgentChainBridge | null {
  if (typeof window === "undefined") return null;
  // ⚠ Local cast, not a `Window` augmentation — see `@/shared/lib/desktop`.
  const channels = (window as unknown as { dopl?: { channels?: unknown } }).dopl
    ?.channels as Partial<DoplAgentChainBridge> | undefined;
  if (!channels) return null;
  return typeof channels.getAgentChain === "function" &&
    typeof channels.setAgentChain === "function"
    ? (channels as DoplAgentChainBridge)
    : null;
}

export interface ChannelAgentChainState {
  /** The bridge, or null in a plain browser / an older desktop build. */
  bridge: DoplAgentChainBridge | null;
  on: boolean;
  busy: boolean;
  update: (on: boolean) => Promise<void>;
}

export function useChannelAgentChain(channelId: string): ChannelAgentChainState {
  const [bridge, setBridge] = useState<DoplAgentChainBridge | null>(null);
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false);

  // ⚠ Feature-detect after mount so SSR and first client render agree.
  useEffect(() => {
    setBridge(getDesktopAgentChain());
  }, []);

  useEffect(() => {
    if (!bridge) return;
    let alive = true;
    bridge
      .getAgentChain(channelId)
      .then((next) => {
        if (alive) setOn(next === true);
      })
      // ⚠ OFF IS THE FAILURE DIRECTION — a read this page cannot complete must
      // never render as a lifted bound.
      .catch(() => {
        if (alive) setOn(false);
      });
    return () => {
      alive = false;
    };
  }, [bridge, channelId]);

  // ⚠ Optimistic, and REVERTS if the desktop refused: never claim a setting that
  // was not stored.
  const update = useCallback(
    async (next: boolean) => {
      if (!bridge || busy) return;
      const previous = on;
      setOn(next);
      setBusy(true);
      try {
        const res = await bridge.setAgentChain(channelId, next);
        setOn(!res || res.ok !== true ? previous : next);
      } catch {
        setOn(previous);
      } finally {
        setBusy(false);
      }
    },
    [bridge, busy, channelId, on]
  );

  return { bridge, on, busy, update };
}
