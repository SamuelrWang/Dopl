"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Per-channel PERMISSION ARM over the desktop bridge
 * (`window.dopl.channels.get/setPermissionPreset`). Picked BEFORE Allow and
 * stored on the DESKTOP, per channel, so the launched session starts on exactly
 * the posture that was approved.
 *
 * ⚠ IT IS AN ARM, NOT A SETTING — say it that way in every surface that shows
 * it. `main/channel-prefs.js` makes the stored pair SINGLE USE
 * (`consumePermissionPreset` returns and deletes in one call), EXPIRING
 * ({@link PERMISSION_ARM_TTL_MS}), and consumable by ONE caller: the
 * consent-APPROVED launch path, only when a human clicked Allow. As a durable
 * preference, one card's `bypass`/`auto_both` silently re-armed every later
 * session on the channel. ⚠ A UI may NEVER present it as a standing preference.
 *
 * ⚠ Bridge feature-detected AFTER mount (window-only) so SSR and first client
 * render agree; null forever in a plain browser, and every consumer renders
 * NOTHING when null.
 *
 * ⚠ The values are the desktop's REAL enums (`main/session-profiles.js`), which
 * re-validates every write — this module's job is to keep the web from offering
 * a value main would reject.
 */

// ⚠ THE TWO AXES, THE PRESET TYPE, ITS DEFAULT AND ITS NORMALIZER MOVED OUT ON
// 2026-08-20 — `../lib/permission-modes`. They are shared vocabulary the DURABLE
// LAUNCH POSTURE also speaks, and this hook is being deleted with the arm; they were
// moved ahead of that so the deletion cannot take them with it.
import {
  DEFAULT_PERMISSION_PRESET,
  normalizePermissionPreset,
  type PermissionPreset,
} from "../lib/permission-modes";

/**
 * ⚠ Hand-copied from `ARM_TTL_MS` in `main/channel-prefs.js` — restated ONLY so
 * the UI can say it out loud. The desktop is the authority; nothing on the web
 * enforces it. `channels-v2/settings-tab.test.tsx` pins it against the desktop
 * source so the copy cannot drift from the clock it describes.
 */
export const PERMISSION_ARM_TTL_MS = 30 * 60_000;

/**
 * Every mounted reader of one channel's arm, keyed by channel id.
 *
 * ⚠ Several surfaces show this pair at once (request card, Settings tab, and
 * there can be two request cards). With a PRIVATE mount snapshot each writing
 * `{...snapshot, ...patch}`, the second writer reverts the axis the first just
 * changed while the first keeps displaying a value it no longer has — and the
 * card's whole contract is that Allow launches what it SHOWS.
 *
 * ⚠ So a write (a) merges onto what is STORED, never a mount snapshot, and
 * (b) broadcasts here so every mounted reader adopts the pair in the same frame.
 */
const armReaders = new Map<string, Set<(next: PermissionPreset) => void>>();

function broadcastArm(channelId: string, next: PermissionPreset) {
  const readers = armReaders.get(channelId);
  if (readers) for (const adopt of readers) adopt(next);
}

/**
 * The narrow permission-preset bridge exposed by the desktop preload. Present
 * ONLY inside the desktop shell, and only on a build new enough to have it.
 */
export interface DoplPermissionPresetBridge {
  /** The channel's stored pair, or null when nothing is stored. */
  getPermissionPreset: (channelId: string) => Promise<PermissionPreset | null>;
  /** Store a pair. `ok: false` when main rejected a value. */
  setPermissionPreset: (
    channelId: string,
    preset: PermissionPreset
  ) => Promise<{ ok: boolean }>;
}

/**
 * The bridge inside the desktop shell with the preset API present, else null.
 * Feature-detected on `setPermissionPreset`, so a plain browser and an older
 * desktop build (marker + folder API, no preset API) both yield null.
 */
export function getDesktopPermissionPresets(): DoplPermissionPresetBridge | null {
  if (typeof window === "undefined") return null;
  // ⚠ Local cast, not a `Window` augmentation — see `@/shared/lib/desktop`.
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
  /** The pair the NEXT allowed request would launch with (defaults when unset). */
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

  // ⚠ Feature-detect after mount so SSR and first client render agree.
  useEffect(() => {
    setBridge(getDesktopPermissionPresets());
  }, []);

  // Nothing stored (or unrecognized) shows the restrictive defaults. ⚠ An EXPIRED
  // arm reads as nothing stored, so the control snapping back to manual/ask is
  // the truth, not a glitch.
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

  // Join the channel's reader set so a write from ANOTHER surface lands here
  // (`armReaders`). `setPreset` is a stable setState function, so this
  // subscribes once per channel rather than every render.
  useEffect(() => {
    if (!bridge) return;
    const readers = armReaders.get(channelId) ?? new Set<(n: PermissionPreset) => void>();
    armReaders.set(channelId, readers);
    readers.add(setPreset);
    return () => {
      readers.delete(setPreset);
      if (readers.size === 0) armReaders.delete(channelId);
    };
  }, [bridge, channelId]);

  // ⚠ Optimistic, and REVERTS if the desktop refused: never leave the card
  // claiming a posture that was not stored.
  const update = useCallback(
    async (patch: Partial<PermissionPreset>) => {
      if (!bridge || busy) return;
      const previous = preset;
      const optimistic: PermissionPreset = { ...preset, ...patch };
      if (
        optimistic.tools === previous.tools &&
        optimistic.messages === previous.messages
      ) {
        return;
      }
      setPreset(optimistic);
      broadcastArm(channelId, optimistic);
      setBusy(true);
      try {
        // ⚠ Merge onto what is STORED RIGHT NOW, never this component's mount
        // snapshot — another surface may have moved the OTHER axis since.
        const stored = await bridge
          .getPermissionPreset(channelId)
          .then(normalizePermissionPreset)
          .catch(() => null);
        const next: PermissionPreset = { ...(stored ?? previous), ...patch };
        const res = await bridge.setPermissionPreset(channelId, next);
        const settled = !res || res.ok !== true ? previous : next;
        setPreset(settled);
        broadcastArm(channelId, settled);
      } catch {
        setPreset(previous);
        broadcastArm(channelId, previous);
      } finally {
        setBusy(false);
      }
    },
    [bridge, busy, channelId, preset]
  );

  return { bridge, preset, busy, update };
}
