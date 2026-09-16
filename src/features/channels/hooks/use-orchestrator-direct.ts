"use client";

/**
 * ORCHESTRATOR DIRECTIONS — may the operator's own EXTERNAL Claude session send
 * PRIVATE INSTRUCTIONS to agents already running on THIS Mac (2026-08-31 lane,
 * control built 2026-09-16).
 *
 * ⚠ **THIS HOOK IS THE MISSING HALF THAT COST FIFTEEN DAYS**, and the reason is
 * worth keeping at the top of the file it was absent from. The direct lane
 * shipped on 2026-08-31 with its store key, its IPC pair
 * (`main/channel-dir-ipc.js › orchestrator:get/setDirectEnabled`) and its preload
 * bridge (`renderer/app-preload.js › orchestratorDirect`) all present — and no
 * caller. `orchestratorDirectEnabled` was therefore never written by anything, so
 * `main/orchestrator-consent.js › getOrchestratorDirect` answered `false` forever,
 * `main/agent-directions.js › handle` dropped every row at its first gate, and
 * **38 of 38 directions filed between 2026-08-31 and 2026-09-15 expired unclaimed
 * with nobody able to tell why.** The trace is `DIRECTION-DROP-TRACE.md`.
 * `scripts/check-bridge-caller-drift.mjs` is what makes a bridge with no caller
 * fail the build rather than ship silent.
 *
 * ⚠ IT IS PER-MACHINE, NOT PER-CHANNEL — `use-orchestrator-launch.ts`'s scope rule
 * verbatim, and for the same reason: one store key, one answer, so flipping it in
 * one room flips it in all of them. The scope rides the CONTROL's option text
 * ("In every channel"), which is the phrase the neighbouring Launch agents row
 * already uses for its own machine-wide pick — same words, same scope, learned
 * once (`settings-desktop-rows.tsx › DirectAgentsRow`).
 *
 * ⚠ DEFAULT OFF, AND THE DEFAULT IS A CONTAINMENT DECISION. The capability lets a
 * session outside this app start a TURN inside an agent already running here, so
 * "could not ask" and "not answered yet" must both read OFF — never "probably on".
 * Every failure path below lands on `false`.
 *
 * ⚠ IT MIRRORS THE STORE, IT DOES NOT OWN IT. Main is the record; this reads once
 * per bridge and writes through, optimistic with REVERT on refusal — never leave a
 * switch claiming a posture that was not stored.
 *
 * ⚠ **A SEPARATE GRANT FROM `orchestratorLaunch`, NEVER A SECOND SPELLING OF IT.**
 * Launching buys COMPUTE; directing reaches a RUNNING agent's private lane. The
 * store keeps two keys by ruling (`main/orchestrator-consent.js`: "ONE TOGGLE PER
 * CAPABILITY, NEVER ONE FOR THE FAMILY"), so this hook is a sibling of
 * `use-orchestrator-launch.ts` and must not be folded into it.
 */

import { useCallback, useEffect, useState } from "react";

/**
 * ⚠ DECLARED LOCALLY, mirroring `use-orchestrator-launch.ts`'s interface for the
 * reason that file's header gives: a TYPE is not what makes the op real, the
 * preload is. `@/shared/lib/spa-bridge.ts › SpaBridgeSurface` does declare
 * `orchestratorDirect`, but the detector below is still what proves it at runtime,
 * and a build that does not match reads as no bridge — the answer a plain browser
 * gives.
 */
export interface DoplOrchestratorDirectBridge {
  get: () => Promise<{ enabled: boolean }>;
  set: (enabled: boolean) => Promise<{ ok: boolean }>;
}

/**
 * The bridge inside the desktop shell with the orchestrator-direct pair, else null.
 *
 * ⚠ CAPABILITY-KEYED, NEVER TRUTHINESS — the rule the whole bridge family follows.
 * BOTH members are probed: "has the getter, has no setter" is a real build shape
 * while this ships, and a row that can read but not write is worse than no row.
 */
function getDesktopOrchestratorDirect(): DoplOrchestratorDirectBridge | null {
  if (typeof window === "undefined") return null;
  const member = (window as unknown as { dopl?: { orchestratorDirect?: unknown } })
    .dopl?.orchestratorDirect as Partial<DoplOrchestratorDirectBridge> | undefined;
  if (!member) return null;
  return typeof member.get === "function" && typeof member.set === "function"
    ? (member as DoplOrchestratorDirectBridge)
    : null;
}

export interface OrchestratorDirectState {
  /** The bridge, or null in a plain browser / a main without the ops. ⚠ null
   *  renders NO ROW at all, never a disabled one (INVARIANTS §5, no dead rows). */
  bridge: DoplOrchestratorDirectBridge | null;
  enabled: boolean;
  busy: boolean;
  update: (enabled: boolean) => Promise<void>;
}

export function useOrchestratorDirect(): OrchestratorDirectState {
  const [bridge, setBridge] = useState<DoplOrchestratorDirectBridge | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);

  // ⚠ Feature-detect after mount so SSR and first client render agree.
  useEffect(() => {
    setBridge(getDesktopOrchestratorDirect());
  }, []);

  // ⚠ NO CHANNEL IN THE DEPS — the machine-scope rule expressed as code: switching
  // channels must not re-read a flag that cannot have changed.
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
  // that was not stored. A refusal here means outside sessions still CANNOT direct
  // agents on this Mac, which is the direction a failure must fall.
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
