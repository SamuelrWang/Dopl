"use client";

import { useCallback, useEffect, useState } from "react";
import {
  DEFAULT_PERMISSION_PRESET,
  normalizePermissionPreset,
  type PermissionPreset,
} from "../lib/permission-modes";

/**
 * Per-channel DURABLE LAUNCH POSTURE over the desktop bridge
 * (`window.dopl.channels.get/setLaunchPosture`). The two axes the operator's OWN
 * agent starts on when they press Launch on the Agents tab.
 *
 * ⚠ THIS IS NOT THE ARM, AND THE DIFFERENCE IS A SECURITY RULE, NOT A STYLE.
 * `use-channel-permission-preset.ts` is the single-use, 30-minute, consent-only
 * arm: it exists so a posture chosen on a card in front of a human applies to the
 * launch that card approves and to nothing else. THIS record is durable, has no
 * TTL, and is spent by nothing — because its one consumer
 * (`main/channel-dir-ipc.js › sessions:launch`) is a button the operator is
 * pressing, on their own thread, with no peer and no consent row involved.
 * `main/channel-prefs.js` states the split in full; read it before wiring either
 * hook to the other's surface.
 *
 * ⚠ WHY IT EXISTS AT ALL. The Settings tab rendered the ARM beside the tool
 * profile, the working folder and auto-send — all durable — and it was
 * indistinguishable from them. The operator picked Bypass, the first launch spent
 * it (or thirty minutes passed), and every later session quietly started
 * manual/ask while the control still read "Bypass". A fuse drawn as a switch is
 * worse than either one.
 *
 * ⚠ IT IS SUPERVISION, NEVER CONTAINMENT. `bypass` stays bounded by the channel's
 * tool profile and by `main/session-profiles.js › SESSION_HARD_DENY`, and Axis B
 * still refuses to let any tool posture send a message. Widening this cannot widen
 * what the agent can reach.
 *
 * ⚠ Bridge feature-detected AFTER mount (window-only) so SSR and the first client
 * render agree; null forever in a plain browser, and every consumer renders
 * NOTHING when null.
 */

/**
 * Every mounted reader of one channel's posture. Same reason as the arm's
 * `armReaders`: the Settings tab can be open in the main window and a pop-out at
 * once, and a private mount snapshot would let the second writer revert the axis
 * the first just changed.
 */
const postureReaders = new Map<string, Set<(next: PermissionPreset) => void>>();

function broadcastPosture(channelId: string, next: PermissionPreset) {
  const readers = postureReaders.get(channelId);
  if (readers) for (const adopt of readers) adopt(next);
}

/** The narrow launch-posture bridge exposed by the desktop preload. */
export interface DoplLaunchPostureBridge {
  /** The channel's EFFECTIVE pair. ⚠ Never null from a current main — an unset
   *  channel really is manual/ask, unlike an arm that was never chosen. The
   *  nullable type is for an older build answering nothing. */
  getLaunchPosture: (channelId: string) => Promise<PermissionPreset | null>;
  /** Store a pair. `ok: false` when main rejected a value. */
  setLaunchPosture: (
    channelId: string,
    preset: PermissionPreset
  ) => Promise<{ ok: boolean }>;
}

/**
 * The bridge inside the desktop shell with the posture API present, else null.
 * Feature-detected on `setLaunchPosture` so a plain browser and any desktop build
 * older than the split both yield null — and the Settings tab then renders no
 * posture control at all, rather than one that writes nowhere.
 */
export function getDesktopLaunchPosture(): DoplLaunchPostureBridge | null {
  if (typeof window === "undefined") return null;
  // ⚠ Local cast, not a `Window` augmentation — see `@/shared/lib/desktop`.
  const channels = (window as unknown as { dopl?: { channels?: unknown } }).dopl
    ?.channels as Partial<DoplLaunchPostureBridge> | undefined;
  if (!channels) return null;
  return typeof channels.getLaunchPosture === "function" &&
    typeof channels.setLaunchPosture === "function"
    ? (channels as DoplLaunchPostureBridge)
    : null;
}

export interface ChannelLaunchPostureState {
  /** The bridge, or null in a plain browser / a desktop older than the split. */
  bridge: DoplLaunchPostureBridge | null;
  /** The pair the operator's next own launch will start on. */
  posture: PermissionPreset;
  /** True while a write is in flight. */
  busy: boolean;
  /** Persist a new value on one axis; the other is carried through unchanged. */
  update: (patch: Partial<PermissionPreset>) => Promise<void>;
}

export function useChannelLaunchPosture(
  channelId: string
): ChannelLaunchPostureState {
  const [bridge, setBridge] = useState<DoplLaunchPostureBridge | null>(null);
  const [posture, setPosture] = useState<PermissionPreset>(
    DEFAULT_PERMISSION_PRESET
  );
  const [busy, setBusy] = useState(false);

  // ⚠ Feature-detect after mount so SSR and first client render agree.
  useEffect(() => {
    setBridge(getDesktopLaunchPosture());
  }, []);

  // ⚠ NO EXPIRY BRANCH HERE, DELIBERATELY. The arm's reader treats an expired
  // record as nothing stored and the control snapping back to manual/ask is the
  // truth there. This record does not expire, so a value that changes on its own
  // would be a bug, not a refresh.
  useEffect(() => {
    if (!bridge) return;
    let alive = true;
    bridge
      .getLaunchPosture(channelId)
      .then((next) => {
        if (alive) {
          setPosture(
            normalizePermissionPreset(next) ?? DEFAULT_PERMISSION_PRESET
          );
        }
      })
      .catch(() => {
        if (alive) setPosture(DEFAULT_PERMISSION_PRESET);
      });
    return () => {
      alive = false;
    };
  }, [bridge, channelId]);

  // Join the channel's reader set so a write from ANOTHER surface lands here.
  // `setPosture` is a stable setState function, so this subscribes once per
  // channel rather than every render.
  useEffect(() => {
    if (!bridge) return;
    const readers =
      postureReaders.get(channelId) ??
      new Set<(n: PermissionPreset) => void>();
    postureReaders.set(channelId, readers);
    readers.add(setPosture);
    return () => {
      readers.delete(setPosture);
      if (readers.size === 0) postureReaders.delete(channelId);
    };
  }, [bridge, channelId]);

  // ⚠ Optimistic, and REVERTS if the desktop refused: never leave a settings row
  // claiming a posture that was not stored. That failure is the exact one this
  // record was introduced to end.
  const update = useCallback(
    async (patch: Partial<PermissionPreset>) => {
      if (!bridge || busy) return;
      const previous = posture;
      const optimistic: PermissionPreset = { ...posture, ...patch };
      if (
        optimistic.tools === previous.tools &&
        optimistic.messages === previous.messages
      ) {
        return;
      }
      setPosture(optimistic);
      broadcastPosture(channelId, optimistic);
      setBusy(true);
      try {
        // ⚠ Merge onto what is STORED RIGHT NOW, never this component's mount
        // snapshot — another surface may have moved the OTHER axis since.
        const stored = await bridge
          .getLaunchPosture(channelId)
          .then(normalizePermissionPreset)
          .catch(() => null);
        const next: PermissionPreset = { ...(stored ?? previous), ...patch };
        const res = await bridge.setLaunchPosture(channelId, next);
        const settled = !res || res.ok !== true ? previous : next;
        setPosture(settled);
        broadcastPosture(channelId, settled);
      } catch {
        setPosture(previous);
        broadcastPosture(channelId, previous);
      } finally {
        setBusy(false);
      }
    },
    [bridge, busy, channelId, posture]
  );

  return { bridge, posture, busy, update };
}
