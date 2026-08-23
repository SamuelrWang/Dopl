"use client";

import { useCallback, useEffect, useState } from "react";
import {
  DEFAULT_PERMISSION_PRESET,
  hasModelKey,
  normalizePermissionPreset,
  type PermissionPreset,
} from "../lib/permission-modes";

/**
 * Per-channel DURABLE LAUNCH POSTURE over the desktop bridge
 * (`window.dopl.channels.get/setLaunchPosture`). The two axes — and, since
 * 2026-08-22, the MODEL — the operator's OWN agent starts on when they press
 * Launch.
 *
 * ⚠ THE MODEL RIDES THE SAME RECORD AND THE SAME TWO OPS, which is why it is a
 * field here rather than a hook of its own: main stores one launch posture per
 * channel and reads it at one call site (`session-ipc-ops.js › sessions:launch`).
 * A second record would be a second thing to keep in step at spawn time. ⚠ It is
 * NOT a third permission axis — `permission-modes.ts › PermissionPreset.model`
 * carries that argument.
 *
 * ⚠ THE VOCABULARY CAME OUT OF THE SINGLE-USE ARM, AND THE ARM IS DELETED
 * (2026-08-20, Samuel's ruling). The file this was split out of —
 * `hooks/use-channel-permission-preset.ts`, the 30-minute, consent-only fuse that
 * existed so a posture chosen on a card in front of a human applied to the launch
 * that card approved and to nothing else — **is gone, along with its whole
 * desktop family** (`channelPermissionPresets`, `ARM_TTL_MS`, the four
 * `*PermissionPreset` bridge ops). Its one surface was `launch-panel.tsx`'s
 * inbound disclosure, which had not rendered since the 2026-08-18 consent
 * rewrite, so nothing could arm it (F-233). Do not go looking for that file, and
 * do not reintroduce a TTL here to "match" it.
 *
 * ⚠ SO THIS IS THE ONLY PERMISSION POSTURE LEFT IN THE PRODUCT, and it is
 * DURABLE: no TTL, and spent by nothing — because its one consumer
 * (`main/session-ipc-ops.js › sessions:launch`) is a button the operator is
 * pressing, on their own thread, with no peer and no consent row involved. An
 * inbound request a peer triggered carries no tool posture at all and starts at
 * manual/ask, which is why H2 still holds BY CONSUMER.
 * `main/channel-prefs.js` is the statement of record; read it before wiring this
 * hook to any other surface.
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
 * Every mounted reader of one channel's posture. ⚠ ONE SHARED SET, NEVER A
 * PER-MOUNT SNAPSHOT: the Settings tab can be open in the main window and a
 * pop-out at once, and a private snapshot would let the second writer revert the
 * axis the first just changed. The deleted arm carried the same reader set for
 * exactly this reason — the idiom outlived it, the record it guarded did not.
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
  /**
   * THIS DESKTOP UNDERSTANDS THE MODEL FIELD (2026-08-22).
   *
   * ⚠ IT IS A CAPABILITY, NOT A VALUE, and the Settings tab renders NO MODEL ROW
   * when it is false — the no-dead-rows rule every desktop-only group on that tab
   * follows (INVARIANTS §5). A row that wrote a field main drops is worse than no
   * row: the operator picks Opus, the write "succeeds", and every agent keeps
   * launching on the default with nothing anywhere saying so.
   *
   * ⚠ FALSE UNTIL THE FIRST READ ANSWERS. It is a probe over the reply
   * (`permission-modes.ts › hasModelKey`), not a synchronous member check, so it
   * flips after mount like `bridge` does — and failing toward "no row" is the
   * correct direction while the answer is outstanding.
   */
  modelSupported: boolean;
  /** True while a write is in flight. */
  busy: boolean;
  /** Persist a new value on one axis; the others are carried through unchanged. */
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
  const [modelSupported, setModelSupported] = useState(false);

  // ⚠ Feature-detect after mount so SSR and first client render agree.
  useEffect(() => {
    setBridge(getDesktopLaunchPosture());
  }, []);

  // ⚠ NO EXPIRY BRANCH HERE, DELIBERATELY. The deleted arm's reader treated an
  // expired record as nothing stored, and the control snapping back to manual/ask
  // was the truth THERE. This record does not expire, so a value that changed on
  // its own would be a bug, not a refresh — do not port that branch back in.
  useEffect(() => {
    if (!bridge) return;
    let alive = true;
    bridge
      .getLaunchPosture(channelId)
      .then((next) => {
        if (!alive) return;
        setPosture(normalizePermissionPreset(next) ?? DEFAULT_PERMISSION_PRESET);
        // ⚠ PROBED OFF THE RAW REPLY, before the normalizer, and it is a
        // one-way latch to TRUE. A later read that answers without the key is a
        // version skew this hook cannot resolve, and yanking a control out from
        // under a mid-pick operator is worse than one stale row.
        if (hasModelKey(next)) setModelSupported(true);
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
        optimistic.messages === previous.messages &&
        // ⚠ `?? null` ON BOTH SIDES so an absent model and an explicit `null`
        // compare EQUAL here. They are different facts to the capability probe
        // above, but they are the same POSTURE — and without the coalesce the
        // first Default pick on a fresh channel would look like a change, write,
        // and put a `model` key on a record that had none.
        (optimistic.model ?? null) === (previous.model ?? null)
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

  return { bridge, posture, modelSupported, busy, update };
}
