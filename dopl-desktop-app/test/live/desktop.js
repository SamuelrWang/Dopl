'use strict';

// LIVE CONTRACT HARNESS — THE REAL DESKTOP DECISION CODE, fed real wire data.
//
// NOTHING HERE RE-IMPLEMENTS A RULE. Every verdict this module produces comes out of the
// shipped source in `main/`:
//
//   targeting.classify         sliced from main/targeting.js (+ the LEGACY-THREADS block it
//                              calls into) with the shared `fnOf` / `between` probes.
//   session-pill.pillState     the REAL SESSION-PILL-PURE block — the ONE projection from
//                              engine state to a working/idle/ended pill (F-142), plus
//                              `listeningState`, which splits `idle` into Waiting (query alive)
//                              and Idle (torn down). It lived in `session-summary.js` until the
//                              2026-08-22 split off the 500-line cap.
//
// ── WHAT CHANGED WITH THE ROLLBACK (F-141) ────────────────────────────────────────
// The old harness wired four modules together — channel-engagement, channel-roster,
// channel-threads and channel-agents.routeAddressedAgent — because a message could be
// routed to one of several NAMED agents and the routing was the interesting part. None of
// those modules exist. A message now either concerns this operator's session or it does
// not, and `classify` is the whole decision. So `decide()` collapses to one call, and the
// thing that needs a host is no longer HTTP + a session engine; it is nothing at all.
//
// THE PARAMETER THAT MAKES TWO MACHINES OUT OF ONE MESSAGE SURVIVES INTACT. `classify`
// takes the operator's id, so the SAME real message evaluated with the peer's id IS the
// peer's machine — no second account, no second laptop.
//
// If a module cannot be sliced (mid-edit sentinels, a renamed function), `load()` records
// the reason in `notes` and leaves that half null, so the runner reports the affected
// checks as SKIPPED rather than failing them spuriously.

const { readFileSync } = require('node:fs');
const path = require('node:path');

const MAIN = path.join(__dirname, '..', '..', 'main');
const HELPERS = path.join(__dirname, '..', 'helpers');

async function load() {
  const notes = [];
  const probe = await import(pathToUrl(path.join(HELPERS, 'source-probe.mjs')));

  // classify lives in targeting.js as a private top-level function; `fnOf` brace-matches it
  // with strings/comments masked, which is stricter than an indexOf slice and cannot
  // silently produce an empty block.
  let classify = null;
  try {
    const targeting = readFileSync(path.join(MAIN, 'targeting.js'), 'utf8');
    const legacySrc = readFileSync(path.join(MAIN, 'legacy-threads.js'), 'utf8');
    const legacy = probe.between(
      legacySrc,
      '// ─── BEGIN LEGACY-THREADS',
      '// ─── END LEGACY-THREADS',
      'legacy-threads.js'
    );
    // `isChatIntent` (2026-08-06) is a free variable inside classify — hoisted out of its body
    // so listener-messages can refuse a chat post ahead of the two session-STARTING routes.
    // Self-contained (its const is inside the function), so `fnOf` slices all of it.
    // `mentionsMe` (2026-08-18, wiring plan Phase 7) is the second, on identical terms: the
    // dispatcher gates the passive task-reply notice on the answer classify's 'fyi' verdict
    // is conjoined with, and its MENTIONS_KEY const likewise sits inside the function.
    const built = new Function(
      `${probe.fnOf(targeting, 'metaStr')}\n${legacy}\n${probe.fnOf(targeting, 'isChatIntent')}\n` +
        `${probe.fnOf(targeting, 'mentionsMe')}\n${probe.fnOf(targeting, 'classify')}\n` +
        'return { classify, metaStr, isChatIntent, mentionsMe, noteMyLegacyThread };'
    )();
    classify = built.classify;
  } catch (err) {
    notes.push(`classify unsliceable: ${err && err.message}`);
  }

  // The pill projection. Sliced as a whole block rather than function-by-function because
  // `pillState` reads `ACTIVITY_PILL` and `queryTornDown`, and a lookup table extracted
  // separately from the function that reads it is the exact shape of a test that passes against
  // a stale copy.
  // ⚠ IT MOVED FILES ON 2026-08-22: the mapping split out of `session-summary.js` into
  // `session-pill.js` at the §2 cap. Same block idiom, same sentinels, one fewer free var — the
  // mapping reaches no injected dependency at all now, which is why the `new Function` below
  // takes none.
  let pillState = null;
  let listeningState = null;
  try {
    const pill = readFileSync(path.join(MAIN, 'session-pill.js'), 'utf8');
    const block = probe.between(
      pill,
      '// ─── BEGIN SESSION-PILL-PURE',
      '// ─── END SESSION-PILL-PURE',
      'session-pill.js'
    );
    const built = new Function(
      `${block}\nreturn { pillState, listeningState, PILL_STATES };`
    )();
    pillState = built.pillState;
    // 2026-08-22, Samuel: the `idle` pill covers a session that is still LISTENING (its query is
    // alive; a message feeds it) and one that is not (torn down; a message relaunches it). The
    // live harness carries it because a run reporting "idle" for both is the ambiguity the
    // ruling is about.
    listeningState = built.listeningState;
    if (!Array.isArray(built.PILL_STATES) || built.PILL_STATES.length !== 3) {
      notes.push(`PILL_STATES is not the expected 3-state set: ${JSON.stringify(built.PILL_STATES)}`);
    }
  } catch (err) {
    notes.push(`pillState unsliceable: ${err && err.message}`);
  }

  return { classify, pillState, listeningState, notes };
}

function pathToUrl(p) {
  return require('node:url').pathToFileURL(p).href;
}

const clone = (v) => JSON.parse(JSON.stringify(v));

/**
 * WHAT ONE MACHINE WOULD DO WITH ONE REAL MESSAGE.
 *
 * `classify` is the whole decision since the rollback. Its answer is one of the verdict
 * words targeting.js defines ('ignore' / 'fyi' / 'trigger' / ...); the harness never
 * interprets it, it only reports it and asserts on it, so a new verdict word added in
 * `main/` shows up here as itself rather than as a crash.
 */
function decide(dsk, opts) {
  const { channel, workspaceId, message, myUserId } = opts;
  const entry = { channel: clone(channel), workspaceId };
  const verdict = dsk.classify ? dsk.classify(message, entry, myUserId) : '(classify unsliceable)';
  return {
    myUserId,
    classify: verdict,
    authorKind: message && message.authorKind,
    intent: message && message.metadata && message.metadata.intent,
    toUserId: message && message.metadata && message.metadata.to_user_id,
  };
}

/** Both machines for one message: the sender's and the peer's. */
function bothMachines(dsk, opts) {
  return {
    mine: decide(dsk, { ...opts, myUserId: opts.myUserId }),
    peer: decide(dsk, { ...opts, myUserId: opts.peerUserId }),
  };
}

module.exports = { load, decide, bothMachines, clone };
