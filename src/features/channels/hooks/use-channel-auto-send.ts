"use client";

/**
 * AUTO-SEND — the DURABLE per-channel posture for the operator's OWN agent's
 * replies (Samuel, 2026-08-20). OFF (the default): a drafted reply waits in the
 * thread view's send box for the operator's Send. ON: it posts on its own.
 *
 * Desktop-only, like the working folder: the setting drives the desktop's
 * launch posture (`main/channel-prefs.js › getAutoSend`), so a plain browser
 * renders nothing (`bridge` stays null and the Settings row vanishes whole —
 * the no-dead-rows rule).
 *
 * ⚠ Unlike `use-channel-permission-preset` this is NOT an arm: it is a real
 * setting, chosen on the Settings tab, surviving restarts, single-axis.
 */

import { useCallback, useEffect, useState } from "react";

export interface DoplAutoSendBridge {
  getAutoSend: (channelId: string) => Promise<boolean>;
  setAutoSend: (channelId: string, on: boolean) => Promise<{ ok: boolean; on?: boolean }>;
}

/** The bridge inside the desktop shell with the auto-send API, else null. */
export function getDesktopAutoSend(): DoplAutoSendBridge | null {
  if (typeof window === "undefined") return null;
  // ⚠ Local cast, not a `Window` augmentation — see `@/shared/lib/desktop`.
  const channels = (window as unknown as { dopl?: { channels?: unknown } }).dopl
    ?.channels as Partial<DoplAutoSendBridge> | undefined;
  if (!channels) return null;
  return typeof channels.getAutoSend === "function" &&
    typeof channels.setAutoSend === "function"
    ? (channels as DoplAutoSendBridge)
    : null;
}

export interface ChannelAutoSendState {
  /** The bridge, or null in a plain browser / an older desktop build. */
  bridge: DoplAutoSendBridge | null;
  on: boolean;
  busy: boolean;
  update: (on: boolean) => Promise<void>;
}

export function useChannelAutoSend(channelId: string): ChannelAutoSendState {
  const [bridge, setBridge] = useState<DoplAutoSendBridge | null>(null);
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false);

  // ⚠ Feature-detect after mount so SSR and first client render agree.
  useEffect(() => {
    setBridge(getDesktopAutoSend());
  }, []);

  useEffect(() => {
    if (!bridge) return;
    let alive = true;
    bridge
      .getAutoSend(channelId)
      .then((next) => {
        if (alive) setOn(next === true);
      })
      .catch(() => {
        if (alive) setOn(false);
      });
    return () => {
      alive = false;
    };
  }, [bridge, channelId]);

  // ⚠ Optimistic, and REVERTS if the desktop refused: never claim a posture
  // that was not stored.
  const update = useCallback(
    async (next: boolean) => {
      if (!bridge || busy) return;
      const previous = on;
      setOn(next);
      setBusy(true);
      try {
        const res = await bridge.setAutoSend(channelId, next);
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
