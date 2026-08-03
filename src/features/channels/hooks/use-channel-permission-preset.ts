"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Per-channel PERMISSION PRESET over the desktop bridge
 * (`window.dopl.channels.get/setPermissionPreset`).
 *
 * The operator used to be able to set a session's two permission axes only after
 * the session window opened — i.e. after the agent had already spawned. This
 * preset is picked on the inbound consent card BEFORE Allow and stored on the
 * DESKTOP, per channel, so the launched session starts on exactly the posture
 * that was approved.
 *
 * It mirrors {@link useChannelFolder} deliberately: the bridge is feature-detected
 * AFTER mount (window-only) so SSR and the first client render agree
 * (hydration-safe), it is null forever in a plain browser, and every consumer
 * renders NOTHING when it is null — a permission posture is a local-machine
 * concept and there is nothing to set from a browser.
 *
 * The values are the desktop's REAL enums (main/session-profiles.js). Main
 * re-validates every write against them, so this module's job is to keep the web
 * from ever offering a value main would reject.
 */

/** AXIS A — what this machine's agent may DO. */
export const TOOL_MODES = ["manual", "accept_edits", "auto", "bypass"] as const;
export type ToolMode = (typeof TOOL_MODES)[number];

/** AXIS B — what CROSSES between the two machines. */
export const MESSAGE_MODES = [
  "ask",
  "auto_inbound",
  "auto_outbound",
  "auto_both",
] as const;
export type MessageMode = (typeof MESSAGE_MODES)[number];

export interface PermissionPreset {
  tools: ToolMode;
  messages: MessageMode;
}

/** What an unset channel starts on: the most restrictive pair on both axes. */
export const DEFAULT_PERMISSION_PRESET: PermissionPreset = {
  tools: "manual",
  messages: "ask",
};

/**
 * The narrow permission-preset bridge exposed by the desktop preload. Present
 * ONLY inside the desktop shell, and only on a build new enough to have it.
 */
export interface DoplPermissionPresetBridge {
  /** The channel's stored pair, or null when nothing is stored. */
  getPermissionPreset: (channelId: string) => Promise<PermissionPreset | null>;
  /** Store a pair. `ok: false` when main rejected a value (never trust the web). */
  setPermissionPreset: (
    channelId: string,
    preset: PermissionPreset
  ) => Promise<{ ok: boolean }>;
}

/**
 * Coerce an arbitrary bridge reply into a preset, or null. Both axes must be
 * known: a half-valid pair is rejected whole, exactly like the main-process
 * validator, so a version-skewed desktop can never render as a posture the web
 * cannot name.
 */
export function normalizePermissionPreset(raw: unknown): PermissionPreset | null {
  if (!raw || typeof raw !== "object") return null;
  const { tools, messages } = raw as { tools?: unknown; messages?: unknown };
  const t = TOOL_MODES.find((m) => m === tools);
  const m = MESSAGE_MODES.find((v) => v === messages);
  return t && m ? { tools: t, messages: m } : null;
}

/**
 * The bridge when running inside the desktop shell AND the preset API is present,
 * else null. Feature-detected on `setPermissionPreset` so a plain browser (no
 * bridge) and an older desktop build (marker + folder API but no preset API) both
 * cleanly yield null — the caller renders nothing.
 */
export function getDesktopPermissionPresets(): DoplPermissionPresetBridge | null {
  if (typeof window === "undefined") return null;
  // Read through a local cast, not a `Window` augmentation — `@/shared/lib/desktop`
  // explains why the bridge has no single global type.
  const channels = (window as unknown as { dopl?: { channels?: unknown } }).dopl
    ?.channels as Partial<DoplPermissionPresetBridge> | undefined;
  if (!channels) return null;
  return typeof channels.getPermissionPreset === "function" &&
    typeof channels.setPermissionPreset === "function"
    ? (channels as DoplPermissionPresetBridge)
    : null;
}

export interface ChannelPermissionPresetState {
  /** The bridge, or null in a plain browser / an older desktop build. */
  bridge: DoplPermissionPresetBridge | null;
  /** The posture the next session would launch with (defaults when unset). */
  preset: PermissionPreset;
  /** True while a write is in flight. */
  busy: boolean;
  /** Persist a new value on one axis; the other is carried through unchanged. */
  update: (patch: Partial<PermissionPreset>) => Promise<void>;
}

export function useChannelPermissionPreset(
  channelId: string
): ChannelPermissionPresetState {
  const [bridge, setBridge] = useState<DoplPermissionPresetBridge | null>(null);
  const [preset, setPreset] = useState<PermissionPreset>(
    DEFAULT_PERMISSION_PRESET
  );
  const [busy, setBusy] = useState(false);

  // Feature-detect after mount (window-only) so SSR and first client render agree.
  useEffect(() => {
    setBridge(getDesktopPermissionPresets());
  }, []);

  // Load the stored pair on mount and whenever the channel changes. Nothing
  // stored (or anything unrecognized) shows the restrictive defaults.
  useEffect(() => {
    if (!bridge) return;
    let alive = true;
    bridge
      .getPermissionPreset(channelId)
      .then((next) => {
        if (alive) setPreset(normalizePermissionPreset(next) ?? DEFAULT_PERMISSION_PRESET);
      })
      .catch(() => {
        if (alive) setPreset(DEFAULT_PERMISSION_PRESET);
      });
    return () => {
      alive = false;
    };
  }, [bridge, channelId]);

  // Optimistic: the control shows the new posture immediately, and REVERTS if the
  // desktop refused it. Never leave the card claiming a posture that was not
  // stored — the whole point is that Allow launches what the card shows.
  const update = useCallback(
    async (patch: Partial<PermissionPreset>) => {
      if (!bridge || busy) return;
      const previous = preset;
      const next: PermissionPreset = { ...preset, ...patch };
      if (next.tools === previous.tools && next.messages === previous.messages) {
        return;
      }
      setPreset(next);
      setBusy(true);
      try {
        const res = await bridge.setPermissionPreset(channelId, next);
        if (!res || res.ok !== true) setPreset(previous);
      } catch {
        setPreset(previous);
      } finally {
        setBusy(false);
      }
    },
    [bridge, busy, channelId, preset]
  );

  return { bridge, preset, busy, update };
}
