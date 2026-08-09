// Shared source-extraction helper for the pure session state machine.
//
// The reducer's truth tables are proved against the REAL source, never a copy: each test
// slices the sentinel block out of main/session-reducer.js and evaluates it verbatim in a
// plain Node context, so a test can never drift from what ships.
//
// §2 SPLITS: the pure EFFECT BUILDERS live in main/session-effects.js (H1) and the STATE
// SHAPE — the defaults, initialSessionState, the cap readers and the mode tables — in
// main/session-state.js (2026-07-31, the self-authored inbound conjunct). Both are needed
// because session-reducer.js sits in the ENGINEERING.md §2 zero-headroom cluster.
// session-reducer.js requires them at module scope, ABOVE its own sentinel, so inside its
// block they are free vars — which means the three blocks CONCATENATE back into exactly the
// standalone program the tests always evaluated. `require` is still undefined in that
// context, which is the invariant the extraction is there to prove: nothing in the state
// machine touches electron, the SDK, fs or the network.
//
// Eight test files evaluate this block. They share this helper so a future split costs one
// edit here instead of eight, and so they cannot drift apart on which blocks to include.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import assert from "node:assert/strict";

const HERE = dirname(fileURLToPath(import.meta.url));
const MAIN = (p) => join(HERE, "..", "main", p);

// Slice one BEGIN/END sentinel pair out of a source file, asserting both exist and are
// ordered — a renamed or deleted sentinel must fail loudly, not silently yield "".
function slice(src, name) {
  const from = src.indexOf(`// ─── BEGIN ${name}`);
  const to = src.indexOf(`// ─── END ${name}`);
  assert.notEqual(from, -1, `BEGIN ${name} sentinel missing`);
  assert.notEqual(to, -1, `END ${name} sentinel missing`);
  assert.ok(to > from, `${name} sentinels out of order`);
  return src.slice(from, to);
}

export const EFFECTS_SRC = readFileSync(MAIN("session-effects.js"), "utf8");
export const STATE_SRC = readFileSync(MAIN("session-state.js"), "utf8");
export const REDUCER_SRC = readFileSync(MAIN("session-reducer.js"), "utf8");

// The effect builders and the state shape FIRST: session-reducer's block calls both as free vars.
export const BLOCK = [
  slice(EFFECTS_SRC, "SESSION-EFFECTS"),
  slice(STATE_SRC, "SESSION-STATE"),
  slice(REDUCER_SRC, "SESSION-REDUCER"),
].join("\n");

// Evaluate the concatenated block and hand back everything any test needs. Named exports
// are cheap here and keep each test's destructure unchanged from before the split.
export function loadReducer() {
  return new Function(
    `${BLOCK}
     return { initialSessionState, sessionReducer, nextIdleMs, turnCapReached, costCapReached,
              gatePhase, endedEmit, endLifecycle, endEffects, modesEmit, parkEffects,
              postureWasReset, POSTURE_RESET_NOTE, INACTIVE_NOTE,
              wakeEffects, inboundAutoAccepted, feedInboundEffects, coerceMode,
              nextAbandonMs, idleTimeout, AWAITING_PEER_IDLE_MS, ABANDONED_MS, LAUNCHING_MS,
              DEFAULT_TURN_CAP, DEFAULT_IDLE_MS, DEFAULT_COST_CAP_USD };`
  )();
}
