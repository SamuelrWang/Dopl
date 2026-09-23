"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  DEFAULT_PERMISSION_PRESET,
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
import type { ModelCatalog, ModelCatalogs } from "../lib/model-catalog";
import { useRuntimeCatalogs } from "./use-runtime-catalogs";

/**
 * Per-channel DURABLE LAUNCH POSTURE over the desktop bridge
 * (`window.dopl.channels.get/setLaunchPosture`) — the two axes, and since
 * 2026-08-22 the MODEL, the operator's OWN agent starts on when they press
 * Launch.
 *
 * ⚠ THE MODEL NO LONGER RIDES THIS RECORD (2026-09-23, Samuel: "We don't need a pin
 * model in the settings"). It did from 2026-08-22; main stores no channel model now and
 * the reply carries no `model` key, so there is no field here and no `modelSupported`.
 *
 * ⚠ THE SINGLE-USE ARM IS DELETED (2026-08-20, Samuel's ruling):
 * `hooks/use-channel-permission-preset.ts`, the 30-minute consent-only fuse, went
 * with its whole desktop family after its one surface stopped rendering (F-233) —
 * a fuse drawn as a switch let the operator pick Bypass and every later session
 * start manual/ask under a control still reading "Bypass". Do not reintroduce a
 * TTL here to "match" it.
 *
 * ⚠ SO THIS IS THE ONLY PERMISSION POSTURE LEFT IN THE PRODUCT, and it is
 * DURABLE — no TTL, spent by nothing — because its one consumer
 * (`main/session-ipc-ops.js › sessions:launch`) is a button the operator is
 * pressing, with no peer and no consent row involved. An inbound request a peer
 * triggered carries no tool posture at all and starts at manual/ask, which is why
 * H2 still holds BY CONSUMER. `main/channel-prefs.js` is the statement of record.
 *
 * ⚠ IT IS SUPERVISION, NEVER CONTAINMENT. `bypass` stays bounded by the channel's
 * tool profile and by `main/session-profiles.js › SESSION_HARD_DENY`, and Axis B
 * still refuses to let any tool posture send a message.
 *
 * ⚠ **THE NEW-AGENT POPUP NO LONGER SURFACES THE CHANNEL'S RUNTIME PICK
 * (2026-09-08, Samuel: *"for runtime, there shouldn't be a channel default …
 * Nobody knows what channel default is"*).** The RECORD and every consumer are
 * untouched — Settings still writes `runtime`, `main/session-launch-op.js` still
 * reads it for a launch carrying none. Only `launch-agent-dialog.tsx` changed: it
 * dropped "Channel default" and always names a runtime. ⚠ Do not "restore" a
 * fall-through arm here.
 *
 * ⚠ **AND {@link ChannelLaunchPostureState.connected} IS A CACHED PROBE RESULT,
 * 60s STALE BY DESIGN (2026-09-08, Samuel's correction).** His words: *"even if
 * the user does not have codex or cursor connected, I still want them to be
 * options there so that the user knows that those are options, so they can
 * connect them … It should just be logged in, like it is just put in their
 * default, right? I did not say to remove them."* So `runtimes` is still THE
 * ROSTER, never filtered by this field, and `connected` only says which adapters
 * answered `available()` on the last sweep
 * (`dopl-desktop-app/main/runtime/connectivity.js`: a 1500ms leash per adapter,
 * cached a minute, a hang reading as absent). ⚠ **NEVER GATE AN ACTION ON IT** —
 * the refusal an operator can act on comes from `runtime/index.js › acquire`.
 */

/**
 * Every mounted reader of one channel's posture. ⚠ ONE SHARED SET, NEVER A
 * PER-MOUNT SNAPSHOT: the Settings tab can be open in the main window and a
 * pop-out at once, and a private snapshot would let the second writer revert the
 * axis the first just changed.
 */
const postureReaders = new Map<string, Set<(next: PostureSnapshot) => void>>();

/**
 * WHAT A SECOND MOUNT ADOPTS. ⚠ THE RUNTIME RIDES IT rather than living in a
 * second broadcast: a runtime fanning out on its own clock would let one mount
 * show Codex over a pair the other just rewrote.
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
 * that has the concept — even with nothing stored — so their ABSENCE is how this
 * hook tells an older desktop from an unset channel (`runtime-capability.ts ›
 * hasRuntimeKey`; INVARIANTS §11).
 * ⚠ `runtimes` IS TYPED `unknown` ON PURPOSE: it crossed a process boundary from a
 * possibly newer build, so `normalizeRuntimes` narrows it rather than an assertion.
 */
export interface LaunchPostureReply extends PermissionPreset {
  runtime?: string;
  runtimes?: unknown;
  defaultRuntime?: string;
  /**
   * The ids that answered `available(): ok` on main's last sweep, in registry
   * order. ⚠ OPTIONAL, AND THE ABSENCE IS A THIRD STATE: every desktop older than
   * 2026-09-08 omits the key, and reading that as "nothing is connected" would
   * stamp "not connected" on every pill of a machine that never said (INVARIANTS
   * §8). {@link ChannelLaunchPostureState.connectedKnown} is that lane.
   * ⚠ `unknown` for `runtimes`' reason — it crossed a process boundary.
   */
  connected?: unknown;
}

/** A posture write. ⚠ OMITTING `runtime` LEAVES THE CHANNEL'S PICK UNTOUCHED —
 *  main's own rule (`channel-dir-ipc.js › channels:setLaunchPosture` branches on
 *  `hasOwnProperty`), which is why this is an optional key and never `null`. */
export type LaunchPostureWrite = PermissionPreset & { runtime?: string };

/** The narrow launch-posture bridge exposed by the desktop preload. */
export interface DoplLaunchPostureBridge {
  /** The channel's EFFECTIVE pair. ⚠ Never null from a current main — an unset
   *  channel really is manual/ask; the nullable type is for an older build. */
  getLaunchPosture: (channelId: string) => Promise<LaunchPostureReply | null>;
  /** Store a pair. `ok: false` when main rejected a value. ⚠ The two AXES
   *  validate HARD (an unknown value rejects the whole write); `runtime`
   *  validates SOFT — an unregistered runtime id CLEARS the pick back
   *  to the default rather than failing the pair beside it. */
  setLaunchPosture: (
    channelId: string,
    preset: LaunchPostureWrite
  ) => Promise<{ ok: boolean; runtime?: string }>;
}

/**
 * The bridge inside the desktop shell with the posture API present, else null —
 * feature-detected on `setLaunchPosture`, so the Settings tab renders no posture
 * control at all rather than one that writes nowhere.
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
   * THIS DESKTOP HAS A RUNTIME CONCEPT (2026-08-31, the runtime-adapter port).
   * ⚠ FALSE RENDERS NO RUNTIME ROW AT ALL — the no-dead-rows rule, for its
   * reason: a desktop that predates the field DROPS it on write. An OWN-KEY probe
   * over the raw reply (`runtime-capability.ts › hasRuntimeKey`), latched to true
   * and false until the first read answers.
   */
  runtimeSupported: boolean;
  /** The channel's durable pick, `''` for the DEFAULT adapter. */
  runtime: string;
  /** Every adapter this desktop registered, in registry order. Empty off-desktop.
   *  ⚠ NEVER FILTERED BY {@link connected} — Samuel's 2026-09-08 correction, quoted
   *  in the header: an unconnected runtime is still an OPTION. */
  runtimes: ReadonlyArray<RuntimeDescriptor>;
  /**
   * WHICH OF {@link runtimes} THIS MAC IS CONNECTED TO — main's cached `available()`
   * sweep, in registry order; `[]` when the desktop said nothing
   * ({@link connectedKnown}). ⚠ A LABEL, NEVER A GATE: 60s stale by design, so it
   * is right for a muted "not connected" hint and wrong for disabling anything —
   * spawn re-asks, and its refusal is the one an operator can act on.
   */
  connected: ReadonlyArray<string>;
  /**
   * THIS DESKTOP ANSWERED THE CONNECTIVITY QUESTION AT ALL. ⚠ FALSE IS "IT DID NOT
   * SAY", NOT "NOTHING IS CONNECTED": a desktop older than 2026-09-08 omits the
   * key, and an unknown-is-empty read would stamp "not connected" on a machine
   * running three runtimes (INVARIANTS §8, §11 — UNKNOWN is not EMPTY). Latched.
   */
  connectedKnown: boolean;
  /** The adapter a channel with no pick launches on, `''` when the build says none. */
  defaultRuntime: string;
  /** THE DESCRIPTOR THE CHANNEL'S NEXT LAUNCH WOULD USE — the pick, else the
   *  default, else null. ⚠ EVERY §3 CONTROL READS THIS ONE OBJECT rather than the
   *  list plus an id, so no surface renders Codex's vocabulary against Cursor's
   *  refusals. */
  descriptor: RuntimeDescriptor | null;
  /**
   * EVERY RUNTIME'S MODEL ROSTER, KEYED BY RUNTIME ID (2026-09-21, U6).
   *
   * ⚠ **THIS IS WHAT REPLACED `agent-models.ts` AS THE MODEL ROW'S SOURCE.** That frozen Claude
   * table was read whatever runtime was selected, so picking Codex offered Fable. Every
   * runtime-aware surface reads {@link catalog} instead.
   * ⚠ EACH CARRIES ITS OWN STATUS — `loading` / `ready` / `unavailable` / `stale` — and an empty
   * `models` list means NOTHING without it (INVARIANTS §11).
   */
  catalogs: ModelCatalogs;
  /**
   * THIS DESKTOP SPOKE THE CATALOG CONTRACT AT ALL. ⚠ FALSE IS "IT DID NOT SAY", NOT "NO MODELS"
   * — {@link connectedKnown}'s rule, for the same reason.
   */
  catalogsKnown: boolean;
  /** THE CATALOG {@link descriptor}'s RUNTIME WOULD LAUNCH ON — the one object a model row reads,
   *  so no surface can render one runtime's models beside another's refusals. `null` when this
   *  build said nothing about a non-default runtime. */
  catalog: ModelCatalog | null;
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
  const [runtimeSupported, setRuntimeSupported] = useState(false);
  const [runtime, setRuntime] = useState("");
  const [runtimes, setRuntimes] = useState<RuntimeDescriptor[]>(EMPTY_RUNTIMES);
  const [defaultRuntime, setDefaultRuntime] = useState("");
  const [connected, setConnected] = useState<string[]>(EMPTY_CONNECTED);
  const [connectedKnown, setConnectedKnown] = useState(false);
  // ⚠ U6: the roster half, shared with `use-launch-selection.ts` because both hooks read the same
  // two fields off the same main-process assembly and render the same model row.
  const runtimeCatalogs = useRuntimeCatalogs();
  const { adopt: adoptCatalogs, reloadToken } = runtimeCatalogs;

  // ⚠ Feature-detect after mount (window-only) so SSR and the first client render
  // agree; null forever in a plain browser, and consumers render NOTHING for null.
  useEffect(() => {
    setBridge(getDesktopLaunchPosture());
  }, []);

  /**
   * ⚠ STABLE, AND IT HAS TO BE: the reader set is joined in an effect keyed on
   * `[bridge, channelId]`, so a callback re-created every render would leave and
   * re-join on every keystroke elsewhere in the tab. `setPosture` / `setRuntime`
   * are stable setState functions, so the empty dependency list is honest.
   */
  const adopt = useCallback((next: PostureSnapshot) => {
    setPosture(next.preset);
    setRuntime(next.runtime);
  }, []);

  // ⚠ NO EXPIRY BRANCH HERE, DELIBERATELY. The deleted arm's reader had one; this
  // record does not expire, so a value that changed on its own would be a bug
  // rather than a refresh — do not port that branch back in.
  useEffect(() => {
    if (!bridge) return;
    let alive = true;
    bridge
      .getLaunchPosture(channelId)
      .then((next) => {
        if (!alive) return;
        setPosture(normalizePermissionPreset(next) ?? DEFAULT_PERMISSION_PRESET);
        // ⚠ THE RUNTIME FAMILY IS PROBED OFF THE RAW REPLY, before the normalizer,
        // and a one-way latch to TRUE: yanking a control out from under a mid-pick
        // operator is worse than one stale row.
        if (hasRuntimeKey(next)) setRuntimeSupported(true);
        // ⚠ THE CATALOGS ARE PROBED OFF THE SAME RAW REPLY, before any normalizer, and the
        // own-key probe is what tells an older desktop from a machine with no adapters.
        adoptCatalogs(next);
        // ⚠ NARROWED, NOT ASSERTED: `normalizeRuntimes` drops only entries with no
        // id, so a newer build's unknown field renders as nothing rather than
        // throwing a settings tab away.
        const list = normalizeRuntimes((next as LaunchPostureReply)?.runtimes);
        setRuntimes(list.length ? list : EMPTY_RUNTIMES);
        setDefaultRuntime(
          normalizeRuntimeId(list, (next as LaunchPostureReply)?.defaultRuntime)
        );
        setRuntime(
          normalizeRuntimeId(list, (next as LaunchPostureReply)?.runtime)
        );
        // ⚠ THE ARRAY'S PRESENCE IS THE CAPABILITY, ITS CONTENTS ARE THE ANSWER.
        // An older desktop sends no key, so `connectedKnown` stays false and the
        // row renders no hints; `[]` is a real "nothing is connected". Latched.
        const reported = (next as LaunchPostureReply)?.connected;
        if (Array.isArray(reported)) {
          setConnectedKnown(true);
          // ⚠ NARROWED to ids this desktop actually REPORTED: an id with no
          // descriptor beside it can label nothing, and carrying it would let a
          // consumer believe in a runtime that is on no roster.
          const ids = reported.filter(
            (v): v is string => typeof v === "string" && list.some((d) => d.id === v)
          );
          setConnected(ids.length ? ids : EMPTY_CONNECTED);
        }
      })
      .catch(() => {
        if (alive) setPosture(DEFAULT_PERMISSION_PRESET);
      });
    return () => {
      alive = false;
    };
    // ⚠ `reloadToken` IS A DEPENDENCY ON PURPOSE (U6): main answers `loading` for a live roster on
    // a cold process and reads in the BACKGROUND, so something has to look again. It changes at
    // most six times and only while a catalog is still loading — see `use-runtime-catalogs.ts`.
  }, [adoptCatalogs, bridge, channelId, reloadToken]);

  // Join the channel's reader set so a write from ANOTHER surface lands here.
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
  // claiming a posture that was not stored — the failure this record ended.
  const update = useCallback(
    async (patch: Partial<LaunchPostureWrite>) => {
      if (!bridge || busy) return;
      const previous = posture;
      const previousRuntime = runtime;
      const { runtime: patchRuntime, ...presetPatch } = patch;
      // ⚠ THE RUNTIME KEY'S PRESENCE IS THE SIGNAL, NOT ITS VALUE — `''` is a real
      // pick (back to the default adapter), an ABSENT key leaves it alone, and
      // `hasOwnProperty` is the only way to tell those apart.
      const movesRuntime = Object.prototype.hasOwnProperty.call(patch, "runtime");
      const optimistic: PermissionPreset = { ...posture, ...presetPatch };
      const optimisticRuntime = movesRuntime
        ? normalizeRuntimeId(runtimes, patchRuntime)
        : previousRuntime;
      if (
        optimistic.tools === previous.tools &&
        optimistic.messages === previous.messages &&
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
        // Sends pick cannot re-stamp (or clear) a runtime nobody touched.
        if (movesRuntime) next.runtime = optimisticRuntime;
        const res = await bridge.setLaunchPosture(channelId, next);
        const ok = !!res && res.ok === true;
        const settled = ok ? next : previous;
        // ⚠ MAIN'S OWN ANSWER WINS OVER THE OPTIMISM: it replies with the runtime
        // the store ACTUALLY holds (an unregistered id clears the pick), so echoing
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

  // ⚠ DERIVED, NEVER STORED: state for "which descriptor" would be a second thing
  // to keep in step with a pick that already moves from three places (the read,
  // this mount's write, another mount's broadcast).
  const descriptor = useMemo(
    () => descriptorFor(runtimes, runtime, defaultRuntime),
    [runtimes, runtime, defaultRuntime]
  );

  // ⚠ DERIVED FROM THE DESCRIPTOR'S OWN ID, never from `runtime` alone: an unset channel launches
  // on the DEFAULT adapter, and its model row has to show THAT runtime's roster.
  const catalog = runtimeCatalogs.catalogFor(descriptor?.id ?? "", defaultRuntime);

  return {
    bridge,
    posture,
    catalogs: runtimeCatalogs.catalogs,
    catalogsKnown: runtimeCatalogs.catalogsKnown,
    catalog,
    runtimeSupported,
    runtime,
    runtimes,
    connected,
    connectedKnown,
    defaultRuntime,
    descriptor,
    busy,
    update,
  };
}

/** ⚠ Module-level, so a desktop with no adapters (and every plain browser) hands
 *  every consumer the SAME empty array — `descriptor` is memoized on it. */
const EMPTY_RUNTIMES: RuntimeDescriptor[] = [];

/** The same shared identity, for the same reason: the popup memoizes its preselect
 *  chain on this list. */
const EMPTY_CONNECTED: string[] = [];
