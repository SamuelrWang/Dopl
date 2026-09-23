"use client";

/**
 * THE DURABLE LAUNCH SELECTION AT BOTH SCOPES — one hook, two records, and the ONLY writer of the
 * runtime-keyed half (2026-09-21, U7/U8).
 *
 * ⚠ **ONE HOOK FOR TWO SCOPES BECAUSE THE RECORDS ARE ONE SHAPE.** `main/agent-defaults.js` says
 * so in as many words — the defaults record *"is a launch selection plus one flag"* — and
 * `seedChannel` copies one straight into the other. The plan's U8 asks for *"the same reusable
 * rows and catalog data at BOTH scopes with their DIFFERENT persistence semantics"*, and two
 * hooks over one shape is how the two surfaces come to offer different vocabularies for one
 * record. What differs is spelled in {@link update} and nowhere else.
 *
 * ⚠ **THE PERSISTENCE SEMANTICS ARE THE THING THAT DIFFERS, AND THEY ARE NOT SYMMETRICAL:**
 *   · CHANNEL — an OWN-KEY PATCH. A key the caller did not send is left alone, `''` is a real
 *     clear. Many surfaces write one channel's record, so a control with no native concept must
 *     not wipe the operator's settings (the 2026-09-05 failure, `channel-prefs.js`'s own rule).
 *   · DEFAULTS — the WHOLE RECORD, every time. It has exactly one writer (this tab), main
 *     rewrites it wholesale, and an omitted field really is "no pick".
 *
 * ⚠ **CHANGING THE DEFAULTS MOVES NO EXISTING CHANNEL, BY CONSTRUCTION AND NOT BY CARE.** Every
 * room that exists already has its own record and that record is what every launch reads;
 * `agent-defaults.js › seedChannel` refuses a channel that has one. Samuel's write-once ruling.
 * **Do not add a launch-time fall-back to these defaults** — it would re-point every room whose
 * Settings tab nobody ever opened.
 *
 * ⚠ **A WRITE NEVER ECHOES THE REQUEST. IT RE-READS.** Main validates SOFT in three directions
 * (a `model` is ignored — none is stored since 2026-09-23 —, an unreadable mode floors to the
 * adapter's narrowest, an undeclared native key is dropped) and REJECTS a whole write on a bad
 * axis value. So the rendered value is always what the store actually holds — which is what the plan's *"a rejected
 * native write re-adopts stored values and does not echo the rejected request"* asks for, made
 * structural rather than remembered. Nothing here is optimistic; {@link LaunchSelectionState.busy}
 * is what the controls go inert on.
 *
 * ⚠ **`useChannelLaunchPosture` IS A READ-ONLY SELECTOR OVER THIS HOOK**, not a second store:
 * one bridge read and one reader set per record, so a write here reaches every surface that reads
 * a channel's runtime.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  readLaunchSelection,
  recordFor,
  type LaunchSelection,
  type RuntimeRecord,
} from "../lib/launch-selection";
import type { ModelCatalog, ModelCatalogs } from "../lib/model-catalog";
import { useRuntimeCatalogs } from "./use-runtime-catalogs";
import {
  descriptorFor,
  normalizeRuntimeId,
  normalizeRuntimes,
  type RuntimeDescriptor,
} from "../lib/runtime-capability";

/** ⚠ Module-level identities, so an unanswered read hands every consumer the SAME array. */
const EMPTY_RUNTIMES: ReadonlyArray<RuntimeDescriptor> = [];
const EMPTY_IDS: ReadonlyArray<string> = [];
const NO_LINES: ReadonlyArray<string> = [];

/**
 * WHICH RECORD. ⚠ A CHANNEL SCOPE WITH AN EMPTY ID READS NOTHING — the pop-out mounts before its
 * channel resolves, and a bare `""` would read a record that is not a channel's.
 */
export type LaunchSelectionScope =
  | { kind: "channel"; channelId: string }
  | { kind: "defaults" };

/** ⚠ OWN-KEY THROUGHOUT at channel scope; every key is meaningful at defaults scope. */
export interface LaunchSelectionPatch {
  runtime?: string;
  tools?: string;
  messages?: string;
  /** ⚠ THE WHOLE BAG FOR THE TARGET RUNTIME, never one key — main replaces `native` wholesale
   *  (`launch-selection.js › normalizeRuntimeRecord` merges FIELDS, not the map inside one). */
  native?: Record<string, string>;
  /** ⚠ DEFAULTS SCOPE ONLY. A channel's chaining flag has its own op and its own hook. */
  agentChain?: boolean;
}

interface Bridge {
  read: () => Promise<unknown>;
  write: (payload: Record<string, unknown>) => Promise<{ ok?: boolean; rejected?: unknown }>;
}

export interface LaunchSelectionState {
  /** Null in a plain browser and on a desktop with no such op — the caller renders NOTHING. */
  bridge: Bridge | null;
  /** The desktop has reported its runtime roster. */
  runtimeSupported: boolean;
  runtimes: ReadonlyArray<RuntimeDescriptor>;
  connected: ReadonlyArray<string>;
  /** A read has answered, so {@link connected} is the desktop's word rather than the empty start. */
  connectedKnown: boolean;
  defaultRuntime: string;
  /** The stored pick, `''` for the default adapter. */
  runtime: string;
  /** The descriptor a launch on this record would use. */
  descriptor: RuntimeDescriptor | null;
  /** Dopl's own axis — core's on every adapter. */
  messages: string;
  /** The SELECTED runtime's record. ⚠ Never null, possibly empty. */
  record: RuntimeRecord;
  /** Any runtime's record — what makes "switch away and back restores it" observable. */
  recordFor: (runtimeId: string) => RuntimeRecord;
  /** ⚠ `null` IS A REAL ANSWER AND MUST NOT BECOME ANOTHER RUNTIME'S LIST (`model-catalog.ts ›
   *  catalogFor` has no "else" arm). */
  catalogFor: (runtimeId: string) => ModelCatalog | null;
  catalogs: ModelCatalogs;
  /** Sentences for a record main could not fully honour. ⚠ NEVER a failure of the read. */
  review: ReadonlyArray<string>;
  /** Why the LAST write was refused, or `[]`. ⚠ Cleared by the next write that is accepted. */
  rejected: ReadonlyArray<string>;
  agentChain: boolean;
  busy: boolean;
  update: (patch: LaunchSelectionPatch) => Promise<void>;
}

type ChannelsBridge = {
  getLaunchPosture?: (channelId: string) => Promise<unknown>;
  setLaunchPosture?: (
    channelId: string,
    preset: Record<string, unknown>
  ) => Promise<{ ok?: boolean; rejected?: unknown }>;
  getAgentDefaults?: () => Promise<unknown>;
  setAgentDefaults?: (
    defaults: Record<string, unknown>
  ) => Promise<{ ok?: boolean; rejected?: unknown }>;
};

/**
 * The bridge for this scope, or null — feature-detected on the WRITE member about to be used
 * (INVARIANTS §11: detect the member you are about to call), so a surface renders no control at
 * all rather than one that writes nowhere.
 */
function bridgeFor(scope: LaunchSelectionScope): Bridge | null {
  if (typeof window === "undefined") return null;
  // ⚠ Local cast, not a `Window` augmentation — see `@/shared/lib/desktop`.
  const channels = (window as unknown as { dopl?: { channels?: unknown } }).dopl
    ?.channels as ChannelsBridge | undefined;
  if (!channels) return null;
  if (scope.kind === "channel") {
    if (!scope.channelId) return null;
    const { getLaunchPosture, setLaunchPosture } = channels;
    if (typeof getLaunchPosture !== "function" || typeof setLaunchPosture !== "function") {
      return null;
    }
    return {
      read: () => getLaunchPosture(scope.channelId),
      write: (payload) => setLaunchPosture(scope.channelId, payload),
    };
  }
  const { getAgentDefaults, setAgentDefaults } = channels;
  if (typeof getAgentDefaults !== "function" || typeof setAgentDefaults !== "function") {
    return null;
  }
  return { read: () => getAgentDefaults(), write: (payload) => setAgentDefaults(payload) };
}

const scopeKey = (scope: LaunchSelectionScope) =>
  scope.kind === "channel" ? `channel:${scope.channelId}` : "defaults";

/**
 * Every mounted reader of ONE record. ⚠ ONE SHARED SET, NEVER A PER-MOUNT SNAPSHOT: the Settings
 * tab can be open in the main window and a pop-out at once, and a private snapshot would let the
 * second writer revert the row the first just changed.
 */
const readers = new Map<string, Set<(reply: unknown) => void>>();

function broadcast(key: string, reply: unknown) {
  const set = readers.get(key);
  if (set) for (const adopt of set) adopt(reply);
}

export function useLaunchSelection(scope: LaunchSelectionScope): LaunchSelectionState {
  const kind = scope.kind;
  const channelId = scope.kind === "channel" ? scope.channelId : "";
  const key = scopeKey(scope);
  const [bridge, setBridge] = useState<Bridge | null>(null);
  const [reply, setReply] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [rejected, setRejected] = useState<ReadonlyArray<string>>(NO_LINES);
  /**
   * ⚠ **THE ROSTER HALF IS U6's AND IS SHARED RATHER THAN COPIED** (`use-runtime-catalogs.ts`,
   * whose own header says why): the catalogs ride the SAME reply as this record, so a second
   * reader of the same two fields is the two-readers-one-fact defect with a MODEL LIST as the
   * thing that drifts. It also owns the bounded re-read while a live roster is still `loading`,
   * which is why {@link reloadToken} is in the read effect's dependency list below.
   */
  const runtimeCatalogs = useRuntimeCatalogs();
  const { adopt: adoptCatalogs, reloadToken } = runtimeCatalogs;

  // ⚠ Feature-detect after mount (window-only) so SSR and the first client render agree.
  useEffect(() => {
    setBridge(bridgeFor(kind === "channel" ? { kind, channelId } : { kind: "defaults" }));
  }, [kind, channelId]);

  const adopt = useCallback(
    (next: unknown) => {
      setReply(next ?? null);
      adoptCatalogs(next);
    },
    [adoptCatalogs]
  );

  useEffect(() => {
    if (!bridge) return;
    let alive = true;
    bridge
      .read()
      .then((next) => {
        if (alive) adopt(next);
      })
      // ⚠ THE RESTRICTIVE RECORD IS THE FAILURE DIRECTION — a read this surface cannot complete
      // must never render as a wider setting than the machine actually holds.
      .catch(() => {
        if (alive) adopt(null);
      });
    return () => {
      alive = false;
    };
    // ⚠ `reloadToken` IS A BOUNDED HAND-OFF, NOT A POLL — `use-runtime-catalogs.ts` states the
    // rule and holds the budget. It only ever changes while some catalog is still `loading`.
  }, [adopt, bridge, reloadToken]);

  // Join this record's reader set so a write from ANOTHER surface lands here.
  useEffect(() => {
    if (!bridge) return;
    const set = readers.get(key) ?? new Set<(next: unknown) => void>();
    readers.set(key, set);
    set.add(adopt);
    return () => {
      set.delete(adopt);
      if (set.size === 0) readers.delete(key);
    };
  }, [adopt, bridge, key]);

  const read = useMemo(() => readLaunchSelection(reply), [reply]);
  const runtimes = useMemo(() => {
    const list = normalizeRuntimes((reply as { runtimes?: unknown } | null)?.runtimes);
    return list.length ? list : EMPTY_RUNTIMES;
  }, [reply]);
  const connected = useMemo(() => {
    const raw = (reply as { connected?: unknown } | null)?.connected;
    if (!Array.isArray(raw)) return EMPTY_IDS;
    // ⚠ NARROWED to ids this desktop actually REPORTED: an id with no descriptor beside it can
    // label nothing, and carrying it would let a consumer believe in a runtime on no roster.
    const ids = raw.filter(
      (v): v is string => typeof v === "string" && runtimes.some((d) => d.id === v)
    );
    return ids.length ? ids : EMPTY_IDS;
  }, [reply, runtimes]);
  const defaultRuntime = normalizeRuntimeId(
    runtimes,
    (reply as { defaultRuntime?: unknown } | null)?.defaultRuntime
  );
  const runtime = normalizeRuntimeId(runtimes, read.selection.runtime);
  const descriptor = useMemo(
    () => descriptorFor(runtimes, runtime, defaultRuntime),
    [runtimes, runtime, defaultRuntime]
  );

  const selection: LaunchSelection = read.selection;
  const recordAt = useCallback(
    (runtimeId: string): RuntimeRecord => recordFor(selection, runtimeId, defaultRuntime),
    [defaultRuntime, selection]
  );

  const update = useCallback(
    async (patch: LaunchSelectionPatch) => {
      if (!bridge || busy) return;
      const payload: Record<string, unknown> =
        kind === "channel"
          ? // ⚠ OWN-KEY: exactly the keys the caller sent, and nothing restated. A key that is
            // not here is a field main leaves alone.
            { ...patch }
          : // ⚠ THE WHOLE RECORD. `agent-defaults.js › normalizeDefaults` branches on `v == null`
            // and reads a record WITHOUT it as a pre-U5 legacy one — which migrates the single
            // global `tools` into the DEFAULT runtime's slot and drops every other
            // runtime's settings. Sending `v` and `byRuntime` is what makes Decision #2 true at
            // this scope: switch away and back and both picks are still there.
            wholeDefaultsRecord(selection, patch, {
              runtime,
              defaultRuntime,
              agentChain: (reply as { agentChain?: unknown } | null)?.agentChain === true,
              record: recordAt(patch.runtime ?? runtime),
            });
      setBusy(true);
      try {
        // ⚠ A throwing bridge is a write that did not land, never an unhandled rejection (F22).
        const res = await bridge.write(payload).catch(() => null);
        if (!res || res.ok !== true) {
          // ⚠ NOTHING WAS APPLIED AND NOTHING IS RE-RENDERED. Main fails closed BEFORE the store
          // on a refusal, so the values on screen are still the stored ones — there is no
          // optimistic pick to revert and no rejected value to echo.
          const lines = Array.isArray(res?.rejected)
            ? (res.rejected as unknown[]).map(String).filter(Boolean)
            : NO_LINES;
          setRejected(lines.length ? lines : NO_LINES);
          return;
        }
        setRejected(NO_LINES);
        // ⚠ RE-READ, NEVER ECHO. Main validates SOFT in three directions, so the only honest
        // answer to "what is stored now" is to ask.
        const next = await bridge.read().catch(() => null);
        // ⚠ A failed re-read keeps the last good reply: adopting `null` would drop every row on a
        // write that landed (F22).
        if (next === null) return;
        adopt(next);
        broadcast(key, next);
      } finally {
        setBusy(false);
      }
    },
    [adopt, bridge, busy, defaultRuntime, key, kind, recordAt, reply, runtime, selection]
  );

  return {
    bridge,
    runtimeSupported: runtimes.length > 0,
    runtimes,
    connected,
    connectedKnown: reply !== null,
    defaultRuntime,
    runtime,
    descriptor,
    messages: selection.messages,
    record: recordAt(runtime),
    recordFor: recordAt,
    catalogs: runtimeCatalogs.catalogs,
    catalogFor: (id: string) => runtimeCatalogs.catalogFor(id, defaultRuntime),
    review: read.review,
    rejected,
    agentChain: (reply as { agentChain?: unknown } | null)?.agentChain === true,
    busy,
    update,
  };
}

/**
 * THE DEFAULTS RECORD, WHOLE — the patch merged onto what is stored.
 *
 * ⚠ **THE PATCH'S FIELDS LAND ON THE RUNTIME THE PATCH SELECTS**, not on the one selected before
 * it — `launch-selection.js › patchSelection`'s rule, which has to be true on this side as well
 * because this scope assembles the record rather than patching it. A single write that switches
 * runtime AND sets that runtime's sandbox is one operation, and splitting it would file the new
 * setting under the old runtime.
 * ⚠ **EVERY OTHER RUNTIME'S RECORD IS CARRIED THROUGH UNTOUCHED.** That is Decision #1: Claude's
 * and Codex's settings sit side by side and neither is translated, cleared or reinterpreted when
 * the other is edited.
 * ⚠ **NO PICK (`''`) FILES THE EDIT UNDER THE DEFAULT RUNTIME'S KEY**, the key main's
 * `activeRecord` reads; the pick itself stays `''`.
 */
function wholeDefaultsRecord(
  selection: LaunchSelection,
  patch: LaunchSelectionPatch,
  current: {
    runtime: string;
    defaultRuntime: string;
    agentChain: boolean;
    record: RuntimeRecord;
  }
): Record<string, unknown> {
  const pick = patch.runtime !== undefined ? patch.runtime : current.runtime;
  const target = pick || current.defaultRuntime;
  const byRuntime: Record<string, RuntimeRecord> = { ...selection.byRuntime };
  const next: RuntimeRecord = { ...current.record };
  if (patch.tools !== undefined) next.tools = patch.tools;
  if (patch.native !== undefined) next.native = patch.native;
  byRuntime[target] = next;
  return {
    // ⚠ THE VERSION IS THE ONE MAIN SENT BACK, never a literal typed here. A build whose record
    // version this bundle does not know must not have a version it DOES know stamped onto it.
    ...(selection.v ? { v: selection.v } : {}),
    runtime: pick,
    messages: patch.messages !== undefined ? patch.messages : selection.messages,
    agentChain: patch.agentChain !== undefined ? patch.agentChain : current.agentChain,
    byRuntime,
  };
}
