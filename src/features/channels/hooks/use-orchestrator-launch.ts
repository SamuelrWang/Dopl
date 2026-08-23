"use client";

/**
 * ORCHESTRATOR LAUNCHES — may the operator's own EXTERNAL Claude session start
 * agents on THIS Mac, over the orchestrator MCP directives (2026-08-22).
 *
 * ⚠ IT IS PER-MACHINE, NOT PER-CHANNEL, AND IT IS THE FIRST CONTROL ON THAT TAB
 * THAT IS. Every other desktop-only setting beside it — the working folder,
 * auto-send, the launch posture — is `(channel, this Mac)`. This one is `(this
 * Mac)` alone: flipping it in one channel flips it in all of them, because there
 * is one store key and one answer. The Settings tab carries it under its own
 * GROUP LABEL saying so (`settings-desktop-rows.tsx › OrchestratorLaunchRows`);
 * the label is the whole disambiguation and it is load-bearing, not decoration.
 *
 * ⚠ DEFAULT OFF, AND THE DEFAULT IS A CONTAINMENT DECISION. The capability lets
 * a session outside this app spawn agents that run with real tool profiles on the
 * operator's machine, so "could not ask" and "not answered yet" must both read
 * OFF — never "probably on". Every failure path below lands on `false`.
 *
 * ⚠ IT MIRRORS THE STORE, IT DOES NOT OWN IT. Main is the record
 * (`orchestratorLaunchEnabled`); this reads once per bridge and writes through.
 * Optimistic with REVERT on refusal, the `use-channel-auto-send.ts` idiom
 * verbatim — never leave a switch claiming a posture that was not stored.
 *
 * ⚠ THE BRIDGE SHAPE IS A GUESS AS OF 2026-08-22 AND IS DECLARED LOCALLY ON
 * PURPOSE. The desktop builder adding `orchestratorLaunchEnabled` had not landed
 * the ops when this shipped, so nothing about them exists yet in
 * `@/shared/lib/spa-bridge.ts › SpaBridgeSurface` or its
 * `apps/desktop-ui/src/lib/dopl-bridge.ts` mirror. Declaring them there from
 * this side would be a second author on a file that side is actively editing —
 * and a TYPE is not what makes the op real anyway; the preload is
 * (`test/preload-parity.test.mjs › APP_OPS`). So {@link DoplOrchestratorLaunchBridge}
 * states the assumed shape in ONE place, the detector below proves it at runtime
 * before any of it is called, and a build that does not match simply reads as no
 * bridge — the same answer a plain browser gives. **WHEN THE DESKTOP DECLARATION
 * LANDS, delete this interface and point the cast at the bridge type; nothing
 * else in this file changes.**
 */

import { useCallback, useEffect, useState } from "react";

/**
 * ⚠ ASSUMED, NOT DECLARED — see the file header. `get` answers the stored flag;
 * `set` answers whether main really stored it.
 */
export interface DoplOrchestratorLaunchBridge {
  get: () => Promise<{ enabled: boolean }>;
  set: (enabled: boolean) => Promise<{ ok: boolean }>;
}

/**
 * The bridge inside the desktop shell with the orchestrator-launch pair, else
 * null.
 *
 * ⚠ CAPABILITY-KEYED, NEVER TRUTHINESS — the rule the whole bridge family
 * follows (`spa-bridge.ts › getSpaBridge`). A truthy `window.dopl` proves
 * nothing: the legacy wrapper has one with almost nothing on it, and a main
 * older than these ops has one with everything BUT them. BOTH members are
 * probed, because "has the getter, has no setter" is a real build shape and a
 * row that can read but not write is worse than no row.
 * ⚠ Local cast, not a `Window` augmentation — see `@/shared/lib/desktop`.
 */
function getDesktopOrchestratorLaunch(): DoplOrchestratorLaunchBridge | null {
  if (typeof window === "undefined") return null;
  const member = (window as unknown as { dopl?: { orchestratorLaunch?: unknown } })
    .dopl?.orchestratorLaunch as Partial<DoplOrchestratorLaunchBridge> | undefined;
  if (!member) return null;
  return typeof member.get === "function" && typeof member.set === "function"
    ? (member as DoplOrchestratorLaunchBridge)
    : null;
}

export interface OrchestratorLaunchState {
  /** The bridge, or null in a plain browser / a main without the ops. ⚠ null
   *  renders NO ROW at all, never a disabled one (INVARIANTS §5, no dead rows). */
  bridge: DoplOrchestratorLaunchBridge | null;
  enabled: boolean;
  busy: boolean;
  update: (enabled: boolean) => Promise<void>;
}

export function useOrchestratorLaunch(): OrchestratorLaunchState {
  const [bridge, setBridge] = useState<DoplOrchestratorLaunchBridge | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);

  // ⚠ Feature-detect after mount so SSR and first client render agree.
  useEffect(() => {
    setBridge(getDesktopOrchestratorLaunch());
  }, []);

  // ⚠ NO CHANNEL IN THE DEPS, and that is the machine-scope rule expressed as
  // code: switching channels must not re-read a flag that cannot have changed.
  useEffect(() => {
    if (!bridge) return;
    let alive = true;
    bridge
      .get()
      .then((res) => {
        // ⚠ `=== true`, so a malformed answer from a build whose shape differs
        // from the guess above reads OFF rather than truthy-ON.
        if (alive) setEnabled(res?.enabled === true);
      })
      .catch(() => {
        if (alive) setEnabled(false);
      });
    return () => {
      alive = false;
    };
  }, [bridge]);

  // ⚠ Optimistic, and REVERTS if the desktop refused: never claim a capability
  // that was not stored. A refusal here means agents can still NOT be launched
  // from outside, which is the direction a failure must fall.
  const update = useCallback(
    async (next: boolean) => {
      if (!bridge || busy) return;
      const previous = enabled;
      setEnabled(next);
      setBusy(true);
      try {
        const res = await bridge.set(next);
        setEnabled(!res || res.ok !== true ? previous : next);
      } catch {
        setEnabled(previous);
      } finally {
        setBusy(false);
      }
    },
    [bridge, busy, enabled]
  );

  return { bridge, enabled, busy, update };
}
