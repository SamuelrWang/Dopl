"use client";

/**
 * DEFAULT AGENT SETTINGS — what a channel created FROM NOW ON starts on (Samuel, 2026-09-18).
 *
 * ⚠ **IT IS NOT A SECOND LAUNCH POSTURE, AND THE DIFFERENCE IS THE WHOLE FEATURE.**
 * `use-channel-launch-posture.ts` reads ONE CHANNEL'S durable record — the pair a launch in that
 * room actually starts on. This reads a record keyed by NOTHING: one answer per machine-user,
 * copied INTO a channel's own record once, at creation, by `applyAgentDefaults`
 * (`lib/agent-defaults-seed.ts` is the caller, `main/agent-defaults.js` is the storage).
 *
 * ⚠ **CHANGING IT MOVES NO EXISTING CHANNEL, BY CONSTRUCTION** — not by this hook remembering to
 * be careful. Every room that exists already has its own record and that record is what every
 * launch reads; main's seed refuses a channel that has one. A future reader tempted to make an
 * unset channel "fall back" to these defaults would be re-pointing every room an operator never
 * opened Settings for, which is the opposite of what was asked for.
 *
 * DESKTOP-ONLY, like the posture and the folder: the record lives in the desktop's electron-store,
 * so a plain browser gets `bridge: null` and the Agents tab renders nothing — the no-dead-rows
 * rule (INVARIANTS §5), and here the strong version of it: a control that wrote nowhere would let
 * an operator configure defaults that never reach a channel.
 *
 * ⚠ NO SHARED READER SET, UNLIKE THE POSTURE HOOK. That one fans out because the Settings tab can
 * be open in the main window and a pop-out at once. This record has exactly ONE surface — the
 * profile popup's Agents tab — and a broadcast for a single mount is a mechanism with nothing to
 * keep in step. Add one the day a second surface writes this record, not before.
 */

import { useCallback, useEffect, useState } from "react";
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
 * The read's reply, whole. ⚠ `runtimes` / `connected` are `unknown` for the posture reply's
 * reason — they crossed a process boundary from a possibly newer build, so they are NARROWED
 * rather than asserted.
 */
export interface AgentDefaultsReply extends PermissionPreset {
  /** May agents launched in a NEW channel launch further agents? Default false. */
  agentChain?: boolean;
  runtime?: string;
  runtimes?: unknown;
  defaultRuntime?: string;
  connected?: unknown;
}

/** A defaults write. ⚠ THE WHOLE RECORD, ALWAYS — main rewrites it wholesale, so an omitted
 *  `model` or `runtime` CLEARS it. That is safe here and nowhere else: this hook is the record's
 *  only writer and it always sends every field. */
export interface AgentDefaultsWrite extends PermissionPreset {
  agentChain: boolean;
  runtime: string;
}

export interface DoplAgentDefaultsBridge {
  getAgentDefaults: () => Promise<AgentDefaultsReply | null>;
  setAgentDefaults: (
    defaults: AgentDefaultsWrite
  ) => Promise<{ ok: boolean; defaults?: AgentDefaultsReply }>;
}

/**
 * The bridge inside the desktop shell with the defaults API present, else null — feature-detected
 * on `setAgentDefaults`, so the tab renders no control at all rather than one that writes nowhere.
 */
export function getDesktopAgentDefaults(): DoplAgentDefaultsBridge | null {
  if (typeof window === "undefined") return null;
  // ⚠ Local cast, not a `Window` augmentation — see `@/shared/lib/desktop`.
  const channels = (window as unknown as { dopl?: { channels?: unknown } }).dopl
    ?.channels as Partial<DoplAgentDefaultsBridge> | undefined;
  if (!channels) return null;
  return typeof channels.getAgentDefaults === "function" &&
    typeof channels.setAgentDefaults === "function"
    ? (channels as DoplAgentDefaultsBridge)
    : null;
}

export interface AgentDefaultsState {
  /** The bridge, or null in a plain browser / a desktop older than this change. */
  bridge: DoplAgentDefaultsBridge | null;
  /** The pair a channel created next would start on. */
  defaults: PermissionPreset;
  agentChain: boolean;
  /** This desktop understands the record's `model` field. ⚠ FALSE RENDERS NO MODEL ROW —
   *  `use-channel-launch-posture.ts` states the rule and the reason; both apply unchanged. */
  modelSupported: boolean;
  /** This desktop has a runtime concept. ⚠ FALSE RENDERS NO RUNTIME ROW, same rule. */
  runtimeSupported: boolean;
  /** The pick, `''` for the DEFAULT adapter. */
  runtime: string;
  /** Every adapter this desktop registered, in registry order. ⚠ NEVER filtered by `connected` —
   *  Samuel's 2026-09-08 correction: an unconnected runtime is still an OPTION. */
  runtimes: ReadonlyArray<RuntimeDescriptor>;
  /** The descriptor a launch in a NEW channel would use — the pick, else the default, else null. */
  descriptor: RuntimeDescriptor | null;
  /** True while a write is in flight — every control goes inert. */
  busy: boolean;
  /** Persist a new value on one field; the others are carried through unchanged. */
  update: (patch: Partial<AgentDefaultsWrite>) => Promise<void>;
}

/** ⚠ Module-level so an unanswered read is the SAME array every render rather than a fresh
 *  identity the runtime row would have to re-derive from. */
const EMPTY_RUNTIMES: RuntimeDescriptor[] = [];

export function useAgentDefaults(): AgentDefaultsState {
  const [bridge, setBridge] = useState<DoplAgentDefaultsBridge | null>(null);
  const [defaults, setDefaults] = useState<PermissionPreset>(
    DEFAULT_PERMISSION_PRESET
  );
  const [agentChain, setAgentChain] = useState(false);
  const [busy, setBusy] = useState(false);
  const [modelSupported, setModelSupported] = useState(false);
  const [runtimeSupported, setRuntimeSupported] = useState(false);
  const [runtime, setRuntime] = useState("");
  const [runtimes, setRuntimes] = useState<RuntimeDescriptor[]>(EMPTY_RUNTIMES);
  const [defaultRuntime, setDefaultRuntime] = useState("");

  // ⚠ Feature-detect after mount (window-only) so SSR and the first client render agree.
  useEffect(() => {
    setBridge(getDesktopAgentDefaults());
  }, []);

  /** Adopt a reply. ⚠ THE CAPABILITY PROBES READ THE RAW REPLY, before the normalizer, and latch
   *  to TRUE only — yanking a control out from under a mid-pick operator is worse than one stale
   *  row, and the normalizer's own defaults would make every reply look like it had both keys. */
  const adopt = useCallback((next: AgentDefaultsReply | null) => {
    setDefaults(normalizePermissionPreset(next) ?? DEFAULT_PERMISSION_PRESET);
    setAgentChain(next?.agentChain === true);
    if (hasModelKey(next)) setModelSupported(true);
    if (hasRuntimeKey(next)) setRuntimeSupported(true);
    const list = normalizeRuntimes(next?.runtimes);
    setRuntimes(list.length ? list : EMPTY_RUNTIMES);
    setDefaultRuntime(normalizeRuntimeId(list, next?.defaultRuntime));
    setRuntime(normalizeRuntimeId(list, next?.runtime));
  }, []);

  useEffect(() => {
    if (!bridge) return;
    let alive = true;
    bridge
      .getAgentDefaults()
      .then((next) => {
        if (alive) adopt(next);
      })
      // ⚠ THE RESTRICTIVE PAIR IS THE FAILURE DIRECTION — a read this page cannot complete must
      // never render as a wider default than the machine actually holds.
      .catch(() => {
        if (alive) adopt(null);
      });
    return () => {
      alive = false;
    };
  }, [bridge, adopt]);

  const update = useCallback(
    async (patch: Partial<AgentDefaultsWrite>) => {
      if (!bridge || busy) return;
      // ⚠ THE WHOLE RECORD IS ASSEMBLED HERE, never a bare patch: main rewrites it wholesale, so
      // a partial write would clear whatever the caller did not mention. The two contracts agree
      // deliberately — see `main/agent-defaults.js › setAgentDefaults`.
      const next: AgentDefaultsWrite = {
        tools: patch.tools ?? defaults.tools,
        messages: patch.messages ?? defaults.messages,
        model: patch.model ?? defaults.model,
        agentChain: patch.agentChain ?? agentChain,
        runtime: patch.runtime ?? runtime,
      };
      setBusy(true);
      try {
        const res = await bridge.setAgentDefaults(next);
        // ⚠ ADOPT WHAT WAS STORED, NOT WHAT WAS ASKED FOR. Main validates `model` and `runtime`
        // SOFT — an id this build does not register is dropped — so echoing the request would
        // display a pick the store does not hold.
        if (res && res.ok === true) adopt(res.defaults ?? null);
      } catch {
        // A write that never completed changes nothing here: the rendered value stays the last
        // one main confirmed.
      } finally {
        setBusy(false);
      }
    },
    [adopt, agentChain, bridge, busy, defaults, runtime]
  );

  return {
    bridge,
    defaults,
    agentChain,
    modelSupported,
    runtimeSupported,
    runtime,
    runtimes,
    descriptor: descriptorFor(runtimes, runtime, defaultRuntime),
    busy,
    update,
  };
}
