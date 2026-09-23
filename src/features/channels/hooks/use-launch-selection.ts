"use client";

/**
 * The durable launch selection at both scopes (a channel's record and the profile defaults, one
 * shape) and the only writer of it. `useChannelLaunchPosture` is a read-only selector over this.
 * ⚠ Changing the defaults moves no existing channel: each room has its own record and the defaults
 * are only a creation-time seed. Do not add a launch-time fallback to the defaults.
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

/** ⚠ Module-level so an unanswered read hands every consumer the SAME array. */
const EMPTY_RUNTIMES: ReadonlyArray<RuntimeDescriptor> = [];
const EMPTY_IDS: ReadonlyArray<string> = [];
const NO_LINES: ReadonlyArray<string> = [];

/** A channel scope with an empty id reads nothing (the pop-out mounts before its channel resolves). */
export type LaunchSelectionScope =
  | { kind: "channel"; channelId: string }
  | { kind: "defaults" };

/** Own-key at channel scope; every key is meaningful at defaults scope. */
export interface LaunchSelectionPatch {
  runtime?: string;
  tools?: string;
  messages?: string;
  /** The whole bag for the target runtime: main replaces `native` wholesale. */
  native?: Record<string, string>;
  /** Defaults scope only; a channel's chaining flag has its own op. */
  agentChain?: boolean;
}

interface Bridge {
  read: () => Promise<unknown>;
  write: (payload: Record<string, unknown>) => Promise<{ ok?: boolean; rejected?: unknown }>;
}

export interface LaunchSelectionState {
  /** Null off-desktop; the caller renders nothing. */
  bridge: Bridge | null;
  runtimeSupported: boolean;
  runtimes: ReadonlyArray<RuntimeDescriptor>;
  connected: ReadonlyArray<string>;
  /** A read has answered, so {@link connected} is the desktop's word, not the empty start. */
  connectedKnown: boolean;
  defaultRuntime: string;
  /** The stored pick, `''` for the default adapter. */
  runtime: string;
  descriptor: RuntimeDescriptor | null;
  messages: string;
  /** The selected runtime's record; never null. */
  record: RuntimeRecord;
  recordFor: (runtimeId: string) => RuntimeRecord;
  /** `null` is a real answer, never another runtime's list. */
  catalogFor: (runtimeId: string) => ModelCatalog | null;
  catalogs: ModelCatalogs;
  /** Main's sentences for a record it narrowed; never a failure of the read. */
  review: ReadonlyArray<string>;
  /** Main's reasons the last write was refused, or `[]`. */
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

/** The bridge for this scope, or null, detected on the members it calls (INVARIANTS §11). */
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
 * Every mounted reader of one record. ⚠ One shared set across windows, never a per-mount snapshot,
 * or a pop-out's write would be reverted by the main window.
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
  const runtimeCatalogs = useRuntimeCatalogs();
  const { adopt: adoptCatalogs, reloadToken } = runtimeCatalogs;

  // Feature-detect after mount so SSR and the first client render agree.
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
      // A failed read renders the restrictive record, never a wider one than the machine holds.
      .catch(() => {
        if (alive) adopt(null);
      });
    return () => {
      alive = false;
    };
    // `reloadToken` changes only while a catalog is `loading` (bounded; `use-runtime-catalogs.ts`).
  }, [adopt, bridge, reloadToken]);

  // Join this record's reader set so a write from another surface lands here.
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
    // Only ids with a descriptor: an unrostered id can label nothing.
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
          ? // Channel: an own-key patch; a key not sent is a field main leaves alone.
            { ...patch }
          : // ⚠ Defaults: the whole record with `v`; without `v` main reads it as legacy and
            // drops every other runtime's record (`agent-defaults.js › normalizeDefaults`).
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
          // Main fails closed before the store: the values on screen are still the stored ones.
          const lines = Array.isArray(res?.rejected)
            ? (res.rejected as unknown[]).map(String).filter(Boolean)
            : NO_LINES;
          setRejected(lines.length ? lines : NO_LINES);
          return;
        }
        setRejected(NO_LINES);
        // ⚠ Re-read, never echo: main may narrow what it stores.
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
 * The defaults record, whole: the patch merged onto what is stored. The patch's fields land on the
 * runtime the patch selects (`launch-selection.js › patchSelection`'s rule); every other runtime's
 * record is carried through untouched; no pick (`''`) files the edit under the default runtime's
 * key, the one main's `activeRecord` reads (F1).
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
    // The version main sent back, never a literal typed here.
    ...(selection.v ? { v: selection.v } : {}),
    runtime: pick,
    messages: patch.messages !== undefined ? patch.messages : selection.messages,
    agentChain: patch.agentChain !== undefined ? patch.agentChain : current.agentChain,
    byRuntime,
  };
}
