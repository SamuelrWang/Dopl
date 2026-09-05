import { useCallback, useEffect, useState } from "react";

/**
 * THE PER-MACHINE SESSION TURN CAP (2026-09-05) — how many turns a session on
 * THIS Mac may take before the runtime stops it.
 *
 * ⚠ **MACHINE-SCOPED, LIKE THE ORCHESTRATOR TOGGLE, AND FOR THE SAME REASON.**
 * Main is the record (`settings.js`, key `sessionTurnCap`); this reads once per
 * bridge and writes through. It is an `electron-store` value behind an
 * `appWindowOnly` IPC pair — **no route, no MCP op, no `workspace_settings`
 * column** — because a spawned session has `Bash` and the device token is on
 * disk, so a server-stored cap could be raised by an agent holding the
 * operator's own credential.
 *
 * 🔒 **THREE STATES, AND THEY ARE THREE DIFFERENT TRUTHS.** `null` is UNSET and
 * means the ISSUER-KEYED DEFAULTS apply — one number for a session the operator
 * launched, a smaller one for an agent-issued session, both owned by
 * `main/session-state.js` and pinned there by `test/turn-cap-issuer.test.mjs`.
 * ⚠ **THE VALUES ARE DELIBERATELY NOT REPEATED HERE**: a comment is the copy
 * that goes stale silently, because no test reads it. `0` is UNLIMITED; a
 * positive number is that cap for every session on this machine. ⚠ **Unset and
 * 0 must never be collapsed** — they are opposites, and a control that renders
 * both as "0" or both as empty lies about the machine's posture.
 *
 * ⚠ THE BRIDGE SHAPE IS DECLARED LOCALLY ON PURPOSE, and this is the
 * `use-orchestrator-launch.ts` precedent applied verbatim rather than a new
 * idea. The desktop side of these ops is being built as this ships, so nothing
 * about them exists yet in `@/shared/lib/spa-bridge.ts › SpaBridgeSurface` or
 * its `apps/desktop-ui/src/lib/dopl-bridge.ts` mirror. Declaring them there
 * from this side would put a second author on a file that side is actively
 * editing — and a TYPE is not what makes an op real anyway; the preload is
 * (`test/preload-parity.test.mjs › APP_OPS`). So {@link DoplTurnCapBridge}
 * states the agreed shape in ONE place, the detector below proves it at runtime
 * before any of it is called, and a build that does not match reads as no
 * bridge — the same answer a plain browser gives. **WHEN THE DESKTOP
 * DECLARATION LANDS, delete this interface and point the cast at the bridge
 * type; nothing else in this file changes.**
 */

/**
 * ⚠ AGREED, NOT YET DECLARED — see the file header. The envelope is the one
 * ruled for both sides so neither guesses: `get` answers the stored cap, and
 * `set` answers **MAIN'S OWN VALUE after the write**, never an echo of the
 * request, so an optimistic stamp can be corrected rather than trusted.
 */
export interface TurnCapAnswer {
  /**
   * What the operator SET, not what a session gets: `null` unset, `0`
   * unlimited, positive that cap. ⚠ Main answers this from
   * `readTurnCapSetting()` rather than `getTurnCap(depth)` precisely so unset
   * stays distinguishable from a cap the operator typed that happens to equal
   * whichever default would have applied.
   */
  cap: number | null;
  /**
   * The issuer-keyed defaults that apply while `cap` is unset.
   *
   * ⚠ **THEY COME OVER THE WIRE SO THIS BUNDLE NEVER SPELLS THEM.** The SPA
   * cannot require `session-state.js`, and `turn-cap-issuer.test.mjs` pins each
   * number to exactly ONE statement in the tree — a literal here would be a
   * second statement, in a file no guard watches, stale the day the defaults
   * move. Absent on a build that predates them, which is why they are nullable
   * and why the row omits the numbers rather than inventing them.
   */
  operatorDefault?: number | null;
  agentDefault?: number | null;
}

export interface DoplTurnCapBridge {
  get: () => Promise<TurnCapAnswer>;
  /** `null` deletes the key (back to unset). `{ok:false}` = the store refused;
   *  `cap` still carries what main holds NOW. */
  set: (
    cap: number | null
  ) => Promise<TurnCapAnswer & { ok: boolean; reason?: string }>;
}

/**
 * The bridge inside the desktop shell with the turn-cap pair, else null.
 *
 * ⚠ CAPABILITY-KEYED, NEVER TRUTHINESS — the rule the whole bridge family
 * follows (`spa-bridge.ts › getSpaBridge`). A truthy `window.dopl` proves
 * nothing: a main older than these ops has one with everything BUT them. BOTH
 * members are probed, because "has the getter, has no setter" is a real build
 * shape and a row that can read but not write is worse than no row.
 * ⚠ Local cast, not a `Window` augmentation — see `@/shared/lib/desktop`.
 */
function getDesktopTurnCap(): DoplTurnCapBridge | null {
  if (typeof window === "undefined") return null;
  const member = (window as unknown as { dopl?: { turnCap?: unknown } }).dopl
    ?.turnCap as Partial<DoplTurnCapBridge> | undefined;
  if (!member) return null;
  return typeof member.get === "function" && typeof member.set === "function"
    ? (member as DoplTurnCapBridge)
    : null;
}

/**
 * A cap main could actually have stored: `null`, or a non-negative integer.
 *
 * ⚠ THE GUARD IS WHAT KEEPS `null` MEANINGFUL. `null` is a legitimate answer
 * (unset), so "falsy" cannot be the malformed test — `0` is falsy and is the
 * unlimited posture. Anything that is neither null nor a finite non-negative
 * integer came from a build whose shape differs from the agreed envelope, and
 * is treated as no answer at all.
 */
function usableCap(value: unknown): value is number | null {
  if (value === null) return true;
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

export interface TurnCapState {
  /** The bridge, or null in a plain browser / a main without the ops. ⚠ null
   *  renders NO ROW at all, never a disabled one (INVARIANTS §5, no dead rows). */
  bridge: DoplTurnCapBridge | null;
  /** `null` = unset (issuer-keyed defaults), `0` = unlimited, positive = the cap. */
  cap: number | null;
  /** The defaults that apply while `cap` is unset, as main reported them.
   *  ⚠ `null` = this build did not send them; the row then names no number
   *  rather than printing one nobody measured. */
  operatorDefault: number | null;
  agentDefault: number | null;
  busy: boolean;
  /** Write through. `null` clears back to unset. */
  update: (cap: number | null) => Promise<void>;
}

/** A default main could actually have sent: a non-negative integer. Anything
 *  else — absent, null, a string — means "not reported". */
function usableDefault(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

export function useTurnCap(): TurnCapState {
  const [bridge, setBridge] = useState<DoplTurnCapBridge | null>(null);
  const [cap, setCap] = useState<number | null>(null);
  const [defaults, setDefaults] = useState<{
    operator: number | null;
    agent: number | null;
  }>({ operator: null, agent: null });
  const [busy, setBusy] = useState(false);

  // ⚠ Feature-detect after mount so SSR and first client render agree.
  useEffect(() => {
    setBridge(getDesktopTurnCap());
  }, []);

  /** Both answers carry the defaults, so both refresh them — a refused write
   *  stays byte-identical to a fresh read rather than blanking the words under
   *  the box. */
  const adoptDefaults = (res: TurnCapAnswer | undefined) => {
    setDefaults({
      operator: usableDefault(res?.operatorDefault) ? res.operatorDefault : null,
      agent: usableDefault(res?.agentDefault) ? res.agentDefault : null,
    });
  };

  useEffect(() => {
    if (!bridge) return;
    let alive = true;
    bridge
      .get()
      .then((res) => {
        if (!alive) return;
        // ⚠ An unusable answer reads UNSET rather than being rendered: unset is
        // the state that changes nothing about how sessions already run.
        setCap(usableCap(res?.cap) ? res.cap : null);
        adoptDefaults(res);
      })
      .catch(() => {
        if (alive) setCap(null);
      });
    return () => {
      alive = false;
    };
  }, [bridge]);

  /**
   * ⚠ **MAIN'S ANSWER WINS, WHICHEVER WAY `ok` FELL** — that is the whole point
   * of the envelope answering a value instead of a boolean. On a refusal main
   * still reports what it HOLDS, so adopting `res.cap` leaves the row showing
   * the machine's real posture rather than the operator's rejected intent. The
   * optimistic value is only ever kept when main's answer is unusable, and the
   * previous value is restored when the call threw — a cap that silently reads
   * as something main never stored is the failure this shape exists to prevent.
   */
  const update = useCallback(
    async (next: number | null) => {
      if (!bridge || busy) return;
      const previous = cap;
      setCap(next);
      setBusy(true);
      try {
        const res = await bridge.set(next);
        if (usableCap(res?.cap)) setCap(res.cap);
        else if (!res || res.ok !== true) setCap(previous);
        adoptDefaults(res);
      } catch {
        setCap(previous);
      } finally {
        setBusy(false);
      }
    },
    [bridge, busy, cap]
  );

  return {
    bridge,
    cap,
    operatorDefault: defaults.operator,
    agentDefault: defaults.agent,
    busy,
    update,
  };
}
