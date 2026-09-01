"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  DEFAULT_PERMISSION_PRESET,
  hasModelKey,
  normalizePermissionPreset,
  type PermissionPreset,
} from "../lib/permission-modes";
import {
  descriptorFor,
  hasRuntimeKey,
  normalizeRuntimeId,
  normalizeRuntimes,
  type RuntimeDescriptor,
} from "../lib/runtime-capability";

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
const postureReaders = new Map<string, Set<(next: PostureSnapshot) => void>>();

/**
 * WHAT A SECOND MOUNT ADOPTS. ⚠ THE RUNTIME RIDES IT rather than living in a
 * second broadcast, for the reason the record itself is one record: the two
 * surfaces are the Settings tab in the main window and in a pop-out, and a
 * runtime that fanned out on its own clock would let one mount show Codex over
 * a pair the other just rewrote.
 */
interface PostureSnapshot {
  preset: PermissionPreset;
  /** `''` = the DEFAULT adapter. Never `null` — see `runtime-capability.ts ›
   *  normalizeRuntimeId`, which states why `''` is the only spelling of no pick. */
  runtime: string;
}

function broadcastPosture(channelId: string, next: PostureSnapshot) {
  const readers = postureReaders.get(channelId);
  if (readers) for (const adopt of readers) adopt(next);
}

/**
 * THE READ'S REPLY, WHOLE. ⚠ IT IS WIDER THAN `PermissionPreset` AND THAT IS THE
 * CAPABILITY SURFACE (2026-08-31, the runtime-adapter port). `runtime`,
 * `runtimes` and `defaultRuntime` are ALWAYS present on the read from a build
 * that has the concept — even with nothing stored — exactly as `model` is, and
 * their ABSENCE is how this hook tells an older desktop from an unset channel
 * (`runtime-capability.ts › hasRuntimeKey`; INVARIANTS §11).
 * ⚠ `runtimes` IS TYPED `unknown` ON PURPOSE. It crossed a process boundary from
 * a build that may be newer than this bundle, so it is narrowed by
 * `normalizeRuntimes` rather than asserted into shape here.
 */
export interface LaunchPostureReply extends PermissionPreset {
  runtime?: string;
  runtimes?: unknown;
  defaultRuntime?: string;
}

/** A posture write. ⚠ OMITTING `runtime` LEAVES THE CHANNEL'S PICK UNTOUCHED —
 *  main's own rule (`channel-dir-ipc.js › channels:setLaunchPosture` branches on
 *  `hasOwnProperty`), which is why this is an optional key and never `null`. */
export type LaunchPostureWrite = PermissionPreset & { runtime?: string };

/** The narrow launch-posture bridge exposed by the desktop preload. */
export interface DoplLaunchPostureBridge {
  /** The channel's EFFECTIVE pair. ⚠ Never null from a current main — an unset
   *  channel really is manual/ask, unlike an arm that was never chosen. The
   *  nullable type is for an older build answering nothing. */
  getLaunchPosture: (channelId: string) => Promise<LaunchPostureReply | null>;
  /** Store a pair. `ok: false` when main rejected a value. ⚠ The two AXES
   *  validate HARD (an unknown value rejects the whole write); `model` and
   *  `runtime` validate SOFT — an unregistered runtime id CLEARS the pick back
   *  to the default rather than failing the pair beside it. */
  setLaunchPosture: (
    channelId: string,
    preset: LaunchPostureWrite
  ) => Promise<{ ok: boolean; runtime?: string }>;
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
  /**
   * THIS DESKTOP HAS A RUNTIME CONCEPT (2026-08-31, the runtime-adapter port).
   *
   * ⚠ FALSE RENDERS NO RUNTIME ROW AT ALL — `modelSupported`'s rule, for
   * `modelSupported`'s reason: a desktop that predates the field DROPS it on
   * write, so a live control would let the operator pick Codex and launch every
   * agent on Claude with nothing anywhere saying so. It is an OWN-KEY probe over
   * the raw reply (`runtime-capability.ts › hasRuntimeKey`), latched to true, and
   * false until the first read answers — failing toward "no row" while the answer
   * is outstanding is the correct direction.
   */
  runtimeSupported: boolean;
  /** The channel's durable pick, `''` for the DEFAULT adapter. */
  runtime: string;
  /** Every adapter this desktop registered, in registry order. Empty off-desktop. */
  runtimes: ReadonlyArray<RuntimeDescriptor>;
  /** The adapter a channel with no pick launches on, `''` when the build says none. */
  defaultRuntime: string;
  /**
   * THE DESCRIPTOR THE CHANNEL'S NEXT LAUNCH WOULD USE — the pick, else the
   * default, else null. ⚠ EVERY §3 CONTROL READS THIS ONE OBJECT rather than the
   * list plus an id, so a surface cannot render Codex's vocabulary against
   * Cursor's refusals.
   */
  descriptor: RuntimeDescriptor | null;
  /** True while a write is in flight. */
  busy: boolean;
  /** Persist a new value on one axis; the others are carried through unchanged.
   *  ⚠ A patch with NO `runtime` key leaves the pick untouched (main's rule). */
  update: (patch: Partial<LaunchPostureWrite>) => Promise<void>;
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
  const [runtimeSupported, setRuntimeSupported] = useState(false);
  const [runtime, setRuntime] = useState("");
  const [runtimes, setRuntimes] = useState<RuntimeDescriptor[]>(EMPTY_RUNTIMES);
  const [defaultRuntime, setDefaultRuntime] = useState("");

  // ⚠ Feature-detect after mount so SSR and first client render agree.
  useEffect(() => {
    setBridge(getDesktopLaunchPosture());
  }, []);

  /**
   * ⚠ STABLE, AND IT HAS TO BE. The reader set is joined in an effect keyed on
   * `[bridge, channelId]`; a callback re-created every render would leave and
   * re-join on every keystroke elsewhere in the tab. `setPosture` / `setRuntime`
   * are stable setState functions, so an empty dependency list is honest.
   */
  const adopt = useCallback((next: PostureSnapshot) => {
    setPosture(next.preset);
    setRuntime(next.runtime);
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
        // ⚠ THE RUNTIME FAMILY IS PROBED THE SAME WAY AND LATCHED THE SAME WAY,
        // off the SAME raw reply — it rides the model's ops precisely so there
        // is one read to probe (`main/channel-dir-ipc.js`'s own note).
        if (hasRuntimeKey(next)) setRuntimeSupported(true);
        // ⚠ NARROWED, NOT ASSERTED. A descriptor list from a newer build may
        // carry branches this bundle has never heard of; `normalizeRuntimes`
        // drops only entries with no id, so an unknown field renders as nothing
        // rather than throwing a settings tab away.
        const list = normalizeRuntimes((next as LaunchPostureReply)?.runtimes);
        setRuntimes(list.length ? list : EMPTY_RUNTIMES);
        setDefaultRuntime(
          normalizeRuntimeId(list, (next as LaunchPostureReply)?.defaultRuntime)
        );
        setRuntime(
          normalizeRuntimeId(list, (next as LaunchPostureReply)?.runtime)
        );
      })
      .catch(() => {
        if (alive) setPosture(DEFAULT_PERMISSION_PRESET);
      });
    return () => {
      alive = false;
    };
  }, [bridge, channelId]);

  // Join the channel's reader set so a write from ANOTHER surface lands here.
  // `adopt` is memoized on an empty dependency list, so this subscribes once per
  // channel rather than every render.
  useEffect(() => {
    if (!bridge) return;
    const readers =
      postureReaders.get(channelId) ?? new Set<(n: PostureSnapshot) => void>();
    postureReaders.set(channelId, readers);
    readers.add(adopt);
    return () => {
      readers.delete(adopt);
      if (readers.size === 0) postureReaders.delete(channelId);
    };
  }, [adopt, bridge, channelId]);

  // ⚠ Optimistic, and REVERTS if the desktop refused: never leave a settings row
  // claiming a posture that was not stored. That failure is the exact one this
  // record was introduced to end.
  const update = useCallback(
    async (patch: Partial<LaunchPostureWrite>) => {
      if (!bridge || busy) return;
      const previous = posture;
      const previousRuntime = runtime;
      const { runtime: patchRuntime, ...presetPatch } = patch;
      // ⚠ THE RUNTIME KEY'S PRESENCE IS THE SIGNAL, NOT ITS VALUE. `''` is a real
      // pick (back to the default adapter) and main clears the store for it; an
      // ABSENT key must leave the channel's pick alone. `hasOwnProperty` on the
      // patch is the only way to tell those apart, and it is the same test main
      // applies on its own side of the wire.
      const movesRuntime = Object.prototype.hasOwnProperty.call(patch, "runtime");
      const optimistic: PermissionPreset = { ...posture, ...presetPatch };
      const optimisticRuntime = movesRuntime
        ? normalizeRuntimeId(runtimes, patchRuntime)
        : previousRuntime;
      if (
        optimistic.tools === previous.tools &&
        optimistic.messages === previous.messages &&
        // ⚠ `?? null` ON BOTH SIDES so an absent model and an explicit `null`
        // compare EQUAL here. They are different facts to the capability probe
        // above, but they are the same POSTURE — and without the coalesce the
        // first Default pick on a fresh channel would look like a change, write,
        // and put a `model` key on a record that had none.
        (optimistic.model ?? null) === (previous.model ?? null) &&
        optimisticRuntime === previousRuntime
      ) {
        return;
      }
      setPosture(optimistic);
      setRuntime(optimisticRuntime);
      broadcastPosture(channelId, {
        preset: optimistic,
        runtime: optimisticRuntime,
      });
      setBusy(true);
      try {
        // ⚠ Merge onto what is STORED RIGHT NOW, never this component's mount
        // snapshot — another surface may have moved the OTHER axis since.
        const stored = await bridge
          .getLaunchPosture(channelId)
          .then(normalizePermissionPreset)
          .catch(() => null);
        const next: LaunchPostureWrite = { ...(stored ?? previous), ...presetPatch };
        // ⚠ THE KEY IS ADDED ONLY WHEN THE PATCH CARRIED ONE, so a Permissions or
        // Sends pick puts the same object on the wire it always did and cannot
        // re-stamp (or clear) a runtime nobody touched.
        if (movesRuntime) next.runtime = optimisticRuntime;
        const res = await bridge.setLaunchPosture(channelId, next);
        const ok = !!res && res.ok === true;
        const settled = ok ? next : previous;
        // ⚠ MAIN'S OWN ANSWER WINS OVER THE OPTIMISM. `setLaunchPosture` replies
        // with the runtime the store ACTUALLY holds — an unregistered id clears
        // the pick rather than parking a value nothing can resolve — so echoing
        // the ask would leave the row claiming an adapter that was refused.
        const settledRuntime = ok
          ? normalizeRuntimeId(runtimes, res.runtime ?? optimisticRuntime)
          : previousRuntime;
        setPosture(settled);
        setRuntime(settledRuntime);
        broadcastPosture(channelId, { preset: settled, runtime: settledRuntime });
      } catch {
        setPosture(previous);
        setRuntime(previousRuntime);
        broadcastPosture(channelId, {
          preset: previous,
          runtime: previousRuntime,
        });
      } finally {
        setBusy(false);
      }
    },
    [bridge, busy, channelId, posture, runtime, runtimes]
  );

  // ⚠ DERIVED, NEVER STORED. A second piece of state for "which descriptor" is a
  // second thing to keep in step with the pick, and the pick already moves from
  // three places (the read, this mount's write, another mount's broadcast).
  const descriptor = useMemo(
    () => descriptorFor(runtimes, runtime, defaultRuntime),
    [runtimes, runtime, defaultRuntime]
  );

  return {
    bridge,
    posture,
    modelSupported,
    runtimeSupported,
    runtime,
    runtimes,
    defaultRuntime,
    descriptor,
    busy,
    update,
  };
}

/** ⚠ Module-level, so a desktop with no adapters (and every plain browser) hands
 *  every consumer the SAME empty array rather than a fresh identity per read —
 *  `descriptor` is memoized on it. */
const EMPTY_RUNTIMES: RuntimeDescriptor[] = [];
