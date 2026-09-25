"use client";

/**
 * PER-CHANNEL DESKTOP FLAGS — local booleans the desktop stores per channel
 * (`main/channel-agent-chain.js`), default OFF, never server-written.
 *
 * - AGENT CHAINING lifts the one-generation launch bound (Samuel, 2026-08-31):
 *   an agent launched here may launch further agents. It lifts a DEPTH bound and
 *   grants nothing — a chained launch still needs the `bypass` posture, the
 *   outbound half, the machine-wide "Orchestrator launches" consent, a free slot
 *   and the per-channel launch budget. It applies to sessions started after the
 *   flip (containment, not supervision).
 * - USE MY TOOLS (Samuel, 2026-09-25) gives a SHARED channel's agents the
 *   operator's own tools, on the operator's own turns only
 *   (`main/operator-tools.js`). A private channel has them without it.
 *
 * Desktop-only: a plain browser has no bridge, so `bridge` stays null and the
 * row vanishes whole (the no-dead-rows rule). OFF is the failure direction.
 */

import { useCallback, useEffect, useState } from "react";

type Getter = (channelId: string) => Promise<boolean>;
type Setter = (channelId: string, on: boolean) => Promise<{ ok: boolean; on?: boolean }>;

export interface ChannelFlagBridge {
  get: Getter;
  set: Setter;
}

/** The desktop bridge's `get`/`set` pair for one flag, else null. */
function desktopFlag(getName: string, setName: string): ChannelFlagBridge | null {
  if (typeof window === "undefined") return null;
  // ⚠ Local cast, not a `Window` augmentation — see `@/shared/lib/desktop`.
  const channels = (window as unknown as { dopl?: { channels?: Record<string, unknown> } }).dopl
    ?.channels;
  const get = channels?.[getName];
  const set = channels?.[setName];
  return typeof get === "function" && typeof set === "function"
    ? { get: get as Getter, set: set as Setter }
    : null;
}

export interface ChannelFlagState {
  /** The bridge, or null in a plain browser / an older desktop build. */
  bridge: ChannelFlagBridge | null;
  on: boolean;
  busy: boolean;
  update: (on: boolean) => Promise<void>;
}

function useChannelFlag(channelId: string, getName: string, setName: string): ChannelFlagState {
  const [bridge, setBridge] = useState<ChannelFlagBridge | null>(null);
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false);

  // ⚠ Feature-detect after mount so SSR and first client render agree.
  useEffect(() => {
    setBridge(desktopFlag(getName, setName));
  }, [getName, setName]);

  useEffect(() => {
    if (!bridge) return;
    let alive = true;
    bridge
      .get(channelId)
      .then((next) => {
        if (alive) setOn(next === true);
      })
      // A read this page cannot complete must never render as ON.
      .catch(() => {
        if (alive) setOn(false);
      });
    return () => {
      alive = false;
    };
  }, [bridge, channelId]);

  // Optimistic, and REVERTS if the desktop refused: never claim a setting that was not stored.
  const update = useCallback(
    async (next: boolean) => {
      if (!bridge || busy) return;
      const previous = on;
      setOn(next);
      setBusy(true);
      try {
        const res = await bridge.set(channelId, next);
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

export const useChannelAgentChain = (channelId: string) =>
  useChannelFlag(channelId, "getAgentChain", "setAgentChain");

export const useChannelUseMyTools = (channelId: string) =>
  useChannelFlag(channelId, "getUseMyTools", "setUseMyTools");
