'use strict';

// LIVE CONTRACT HARNESS — THE REAL DESKTOP DECISION CODE, fed real wire data.
//
// NOTHING HERE RE-IMPLEMENTS A RULE. Every verdict this module produces comes out of the
// shipped source in `main/`:
//
//   targeting.classify            sliced from main/targeting.js (+ the LEGACY-THREADS block
//                                 it calls into) with the shared `fnOf` / `between` probes.
//   channel-engagement.*          the REAL CHANNEL-ENGAGEMENT-PURE block.
//   channel-roster.*              the REAL CHANNEL-ROSTER-PURE block.
//   channel-threads.*             the REAL CHANNEL-THREADS-PURE block.
//   channel-agents.routeAddressedAgent  the REAL CHANNEL-AGENTS-PURE block.
//
// The last four are wired together by `test/helpers/channel-agents.mjs` — the suite's own
// harness, REUSED rather than restated, so this lane and the unit lane drive one wiring.
// Its two fakes are exactly the two edges that need a host: HTTP and the session engine.
// THE HTTP FAKE IS FED THE REAL SERVER'S BYTES: `cfg.roster` is the live
// `GET /api/channels/{id}/agents` array and `cfg.participants` is the live
// `GET /api/channels/{id}/tasks/{threadId}` set, so what the roster policy and the thread
// policy see is what the server actually sent.
//
// If a module cannot be sliced (mid-edit sentinels, a renamed function), `load()` throws
// with the module named, and the runner reports the affected checks as SKIPPED rather than
// failing them spuriously.

const { readFileSync } = require('node:fs');
const path = require('node:path');

const MAIN = path.join(__dirname, '..', '..', 'main');
const HELPERS = path.join(__dirname, '..', 'helpers');

async function load() {
  const notes = [];
  let helper = null;
  try {
    helper = await import(pathToUrl(path.join(HELPERS, 'channel-agents.mjs')));
  } catch (err) {
    throw new Error(`cannot load test/helpers/channel-agents.mjs (${err && err.message})`);
  }
  const probe = await import(pathToUrl(path.join(HELPERS, 'source-probe.mjs')));

  // classify lives in targeting.js as a private top-level function; `fnOf` brace-matches it
  // with strings/comments masked, which is stricter than the indexOf slice the unit suite
  // uses and cannot silently produce an empty block.
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
    const built = new Function(
      `${probe.fnOf(targeting, 'metaStr')}\n${legacy}\n${probe.fnOf(targeting, 'classify')}\n` +
        'return { classify, metaStr, noteMyLegacyThread };'
    )();
    classify = built.classify;
  } catch (err) {
    notes.push(`classify unsliceable: ${err && err.message}`);
  }

  return { helper, classify, notes };
}

function pathToUrl(p) {
  return require('node:url').pathToFileURL(p).href;
}

/** Rows are MUTATED by the real summon flow (status flips), so every run gets its own copy. */
const clone = (v) => JSON.parse(JSON.stringify(v));

/**
 * WHAT ONE MACHINE WOULD DO WITH ONE REAL MESSAGE.
 *
 * The order is `listener-messages.dispatchMessage`'s own: the addressed/thread/engaged route
 * runs FIRST and short-circuits, and classify only runs when it answered '' — so a `classify`
 * of `null` below means "never reached", which is a different fact from 'ignore'.
 *
 * `myUserId` is the whole trick. The desktop modules take the operator's id as a parameter,
 * so the SAME real message evaluated with a different id IS the peer's machine — no second
 * account, no second laptop.
 */
async function decide(dsk, opts) {
  const { channel, workspaceId, roster, participants, message, myUserId } = opts;
  const entry = { channel: clone(channel), workspaceId };
  const h = dsk.helper.harness({
    roster: clone(roster),
    // `undefined` (not `[]`) is the "no thread was opened" case: the fake answers 404, which
    // is also the real assertion that an unknown participant set routes nobody.
    participants: participants === undefined ? undefined : clone(participants),
  });
  await h.reconcileChannel(entry, myUserId);
  // The summon pass is SETUP, not the thing under test: forget what it did so the counters
  // below describe this message alone.
  h.calls.summon.length = 0;
  h.calls.wake.length = 0;
  h.calls.feed.length = 0;

  const routed = await h.routeAddressedAgent(entry, message, myUserId);
  const verdict = routed ? null : dsk.classify ? dsk.classify(message, entry, myUserId) : '(classify unsliceable)';

  return {
    myUserId,
    routed,
    classify: verdict,
    fed: h.calls.feed.map((f) => f.agentId),
    woke: h.calls.wake.map((w) => w.agentId),
    selfAuthoredFeeds: h.calls.feed.filter((f) => f.selfAuthored).map((f) => f.agentId),
    // The engagement module's own reading of this message, reported so a failure line can
    // say WHY a route answered as it did.
    addressed: h.addressedAgentIds(message),
    isChat: h.isChat(message),
    humanAuthored: h.humanAuthored(message),
    mayEngage: h.mayEngage(message, myUserId),
    teamAgents: entry.teamAgents,
  };
}

/** Both machines for one message: the sender's and the peer's. */
async function bothMachines(dsk, opts) {
  return {
    mine: await decide(dsk, { ...opts, myUserId: opts.myUserId }),
    peer: await decide(dsk, { ...opts, myUserId: opts.peerUserId }),
  };
}

module.exports = { load, decide, bothMachines, clone };
