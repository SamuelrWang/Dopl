// THE FAILURE LANE of `main/session-state-push.js` — the once-per-shape log line, the
// `retryable` status rule, and (2026-09-14) THE BACKOFF THAT MAKES A FAILED RECONCILE LAND.
//
// ⚠ ITS OWN MODULE for the reason `session-state-push-wire.js` is: that file sits at the
// 500-line cap, and this is a real seam — it changes when FAILURE handling changes, where the
// rest of the writer changes when the PUSH does. It is MINTED PER WRITER because it REMEMBERS
// three things: the failure shapes it has already said out loud, how many cycles have failed in
// a row, and the one timer it may hold.
//
// ── WHY THE BACKOFF EXISTS — the 2026-09-14 01:02 incident ──────────────────────────────
// The writer fires on a STATE CHANGE and on nothing else, which is the whole argument for
// `channel_sessions` existing (that file's header). It is ALSO how ONE failed cycle went
// unrepaired for a whole run. At boot the desktop ended 65 stale records quietly and re-parked
// one, the boot reconcile cycle ran, and it FAILED — `This operation was aborted`, the local API
// slow enough that presence, the version gate and `listWorkspaces` all aborted the same minute.
// No further state change came, so NOTHING RETRIED, and the server kept the PREVIOUS run's 13
// `idle` rows: the Overview agents panel, the Agents tab and every peer's `read_sessions` showed
// ended agents as Idle (Samuel: *"why do i see so many agents in the overview … i should not see
// ended agents"*).
//
// ⚠ IT IS STILL NOT A HEARTBEAT, AND THAT IS A PROPERTY OF WHEN IT ARMS RATHER THAN OF ITS
// PERIOD. A timer is armed ONLY by a cycle that FAILED; a SUCCESSFUL cycle arms nothing and
// CLEARS what was armed; a new state change clears it and runs at once (`schedule`). A machine
// whose pushes land holds no timer at all, so the steady-state cost this module adds is ZERO
// writes — the one thing the writer's header forbids in capitals is still forbidden.
// ⚠ ONE TIMER AT A TIME, cleared on success and on `stop()`.
// ⚠ ONLY A FAILURE THAT MAY ANSWER DIFFERENTLY ARMS IT (`retryable`): a 400 is a bad payload,
// and re-posting one forever is precisely the `ui-sync` ~39 000-attempt storm every retry in this
// tree is written against. The wire filters (`session-state-push-wire.js`) are the fix for that
// shape; a timer would only make it louder.
// ⚠ THE DIGEST RULE IS UNTOUCHED — the writer records no digest on failure — so a retry re-runs
// the reconcile off the CURRENT projection and never replays a stale set. That is also why the
// retry needs no payload of its own: it is the same cycle, later.

// ⚠ **AND THE QUARANTINE (2026-09-14) — ONE POISONED ROW MAY NOT WEDGE A WORKSPACE.** A 4xx is
// NOT retryable, deliberately, and the digest is not recorded on a failure — so a single row the
// SERVER refuses for a reason no client predicate can restate (its channel was deleted, this
// credential is no longer in it) makes EVERY later push for that workspace fail identically:
// `read_sessions` answers [] for the machine, valid rows included, and stale rows are never
// cleared. The three predicates in `session-state-push-wire.js` cover the refusals a client CAN
// restate; this covers the ones only the server knows.
//
// ⚠ **WHY A SWEEP AND NOT A BISECT, MEASURED.** The endpoint is REPLACE-BY-OMISSION, so a probe
// is not free: any subset that SUCCEEDS becomes the stored set. A bisect isolates in ⌈log2 32⌉ = 5
// probes but every successful one WRITES a knowingly truncated projection — the exact failure this
// exists to end, on every reading surface, for as long as it takes to send the next one. The sweep
// probes FULL-SET-MINUS-ONE, so every POST it makes is either a 4xx that writes nothing or the
// CORRECT final set: at most `SESSION_REPORT_MAX` (32) probes, each a single non-retryable attempt
// that 400s immediately (no 15s timeout, no `MAX_ATTEMPTS` doubling), run ONCE because the key is
// then remembered and filtered out up front. 32 fast POSTs on a wedged workspace, never on a
// healthy one, against a wrong projection that does not decay.
//
// ⚠ **TWO BAD ROWS ARE NOT FIXED AND MUST NOT PRETEND TO BE.** No single removal succeeds, the
// sweep spends its probes and answers null, and the cycle fails exactly as it does today — with
// the diag line saying so. Quarantining a row on a guess is how a live agent stops being reported.

// ⚠ THE LADDER IS FIVE STEPS AND THEN A FLOOR AT ITS LAST ONE (every 300s, indefinitely). It
// must outlive a local-API outage of any length — the incident's cost is a WRONG projection on
// every reading surface, which does not decay — while the 5-minute floor keeps a machine that is
// offline for a day at ~12 attempts/hour, two orders under `agent_presence`'s unconditional beat.
const RETRY_BACKOFF_MS = [15000, 30000, 60000, 120000, 300000];

/** The gap a cycle that has already failed `failures` times in a row waits before re-running. */
function delayFor(failures) {
  const i = Math.max(0, Math.min(failures, RETRY_BACKOFF_MS.length - 1));
  return RETRY_BACKOFF_MS[i];
}

// A 5xx or a 429 may differ next time; a 4xx will not (a bad payload, a workspace this
// credential is not in, an expired session api-repair already retried once).
function retryable(status) {
  return status === 429 || status >= 500;
}

const short = (id) => String(id || '').slice(0, 8);


/**
 * ONE WORKSPACE'S QUARANTINE: the rows the SERVER refuses, kept out of later payloads.
 * ⚠ MINTED WITH THE LANE because it remembers, and pruned to the LIVE key set every cycle for
 * `loggedAdHoc`'s reason — an agent that ends takes its quarantine with it, so a row is never
 * banished for longer than the session that owned it.
 */
function makeQuarantine(diag, probe) {
  const banished = new Set(); // `${workspaceId}|${sessionKey}`
  const at = (ws, key) => String(ws) + '|' + String(key);

  /** Rows this workspace may still send. */
  function allowed(workspaceId, rows) {
    if (banished.size === 0) return rows;
    return rows.filter((r) => !banished.has(at(workspaceId, (r && r.sessionKey) || '')));
  }

  /**
   * FIND THE ONE ROW THE SERVER REFUSES, by sending the whole set MINUS each candidate in turn.
   * Answers the banished `sessionKey`, or null when no single removal is enough.
   * ⚠ THE WINNING PROBE IS THE REAL WRITE. It stores exactly the set the next cycle would send,
   * so the projection is correct the moment the sweep succeeds rather than one cycle later.
   * ⚠ NO ACKS ON A PROBE: a receipt spent on a payload that may 400 is a receipt this machine
   * forgot it owed, and `cycle` has already restored them by the time this runs.
   */
  async function sweep(workspaceId, rows) {
    if (!Array.isArray(rows) || rows.length < 2) return null;
    for (let i = 0; i < rows.length; i += 1) {
      const suspect = String((rows[i] && rows[i].sessionKey) || '');
      const without = rows.filter((_, j) => j !== i);
      // ⚠ SERIAL BY CONTRACT AND NOT BY HABIT: each probe is a WRITE on a replace-by-omission
      // endpoint, so two in flight would race to decide what the stored set is.
      const stored = await probe(workspaceId, without);
      if (stored !== true) continue;
      banished.add(at(workspaceId, suspect));
      diag('session-state push: QUARANTINED session', suspect,
        '— the server refuses this row and one of them 400s the whole payload;',
        'the rest of this workspace\'s set is reported normally from here on');
      return suspect;
    }
    diag('session-state push: no single row explains the refusal for ws', short(workspaceId),
      '— the payload is failing for a reason removing one row cannot fix');
    return null;
  }

  /** An agent that left the projection takes its quarantine with it. */
  function prune(liveKeys) {
    for (const entry of [...banished]) {
      if (!liveKeys.has(entry.slice(entry.indexOf('|') + 1))) banished.delete(entry);
    }
  }

  return { allowed, sweep, prune, size: () => banished.size };
}

/**
 * One writer's failure lane.
 *
 * `run` is the writer's own "reconcile the CURRENT projection" entry point (`kick(true)`), called
 * with no arguments and never awaited — a retry is a normal cycle, so it coalesces through the
 * same `schedule` gate as a state change and cannot overlap one.
 *
 * ⚠ `timers` IS THE TEST SEAM AND IT DEFAULTS TO THE REAL CLOCK. The suites drive the backoff by
 * hand through it; the writer passes nothing, which is what keeps `setTimeout(` appearing exactly
 * ONCE in `session-state-push.js` (its bounded-retry gap) — the source fact
 * `test/session-telemetry-cadence.test.mjs` pins so nobody re-grows a heartbeat there.
 */
function makeFailureLane(diag, run, timers) {
  const clock = timers || { set: setTimeout, clear: clearTimeout };
  // One line per (workspace, failure shape). A subsystem that dies must say so ONCE, not once
  // per state change.
  const loggedFailures = new Set();
  let failures = 0; // consecutive FAILED CYCLES, which is what the ladder indexes
  let timer = null;

  /** What the next `armRetry()` would wait. Read by `noteFailure`, so the line a human sees and
   *  the timer that actually arms can never disagree. */
  const nextRetryMs = () => delayFor(failures);

  function drop() {
    if (timer === null) return;
    try { clock.clear(timer); } catch (_err) { /* already fired or gone */ }
    timer = null;
  }

  /** Forget the ladder AND the timer: a success, a state change, or `stop()`. */
  function clearRetry() {
    drop();
    failures = 0;
  }

  /** A cycle failed on a shape that may answer differently: re-run it after the next gap. */
  function armRetry() {
    const ms = delayFor(failures);
    drop();
    failures += 1;
    timer = clock.set(() => {
      timer = null;
      try { run(); } catch (err) {
        diag('session-state push: retry cycle error —', (err && err.message) || String(err));
      }
    }, ms);
    // ⚠ NEVER HOLDS THE PROCESS OPEN — a pending retry must not be the reason a quit waits.
    if (timer && typeof timer.unref === 'function') timer.unref();
    return ms;
  }

  function noteFailure(workspaceId, shape, detail) {
    const key = String(workspaceId) + '|' + shape;
    if (loggedFailures.has(key)) return;
    loggedFailures.add(key);
    diag('session-state push failed —', detail, 'ws', short(workspaceId),
      '— read_sessions will not see this machine until a push lands; retrying in '
      + Math.round(nextRetryMs() / 1000) + 's');
  }

  /** THE OPERATOR HANDOVER: the previous operator's failures are not this one's, and neither is
   *  their place on the ladder. Called on `cycle`'s identity-change branch beside the digests. */
  function forgetFailures() {
    loggedFailures.clear();
    clearRetry();
  }

  function clearFailures(workspaceId) {
    const prefix = String(workspaceId) + '|';
    for (const key of [...loggedFailures]) {
      if (key.startsWith(prefix)) loggedFailures.delete(key);
    }
  }

  return {
    noteFailure,
    clearFailures,
    forgetFailures,
    retryable,
    armRetry,
    clearRetry,
    nextRetryMs,
    /** Test/diag only: is a re-run currently armed? */
    retryPending: () => timer !== null,
  };
}

module.exports = { makeFailureLane, makeQuarantine, retryable, delayFor, RETRY_BACKOFF_MS };
