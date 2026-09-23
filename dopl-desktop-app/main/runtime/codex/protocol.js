// THE CODEX COMPATIBILITY GATE — pure checks over values a caller already extracted (version,
// declared methods, handshake facts, model rows). Split out of `client.js` at the §1 cap; the
// process transport stays there and re-exports these names.

// ── THE COMPATIBILITY GATE ───────────────────────────────────────────────────────────────────
//
// 🔒 ⚠ **"CONNECTED" IS A CLAIM ABOUT A PROTOCOL, NOT ABOUT A FILE BEING PRESENT** (U1,
// `docs/plans/2026-09-21-001-fix-codex-runtime-parity-plan.md`). `probe()` answers "is there a
// `codex`"; it cannot answer "does this app-server speak the protocol this adapter was written
// against". Until 2026-09-21 nothing did — 94 targeted tests passed against SYNTHETIC fixtures
// while the adapter sent request shapes the installed CLI rejects.
//
// ⚠ **`unsupported-protocol` IS NOT `missing` AND NOT `signed-out`.** Install, sign in and upgrade
// are three different operator actions; collapsing them makes "Codex is broken" unanswerable.
//
// 🔒 ⚠ **UNKNOWN IS NOT EMPTY** (`docs/INVARIANTS.md`). `methods: null` (nothing declared) has not
// been MEASURED → `unverified-protocol`. `methods: []` HAS been measured and offers nothing Dopl
// needs → `unsupported-protocol`. Folding the first into the second refuses working installs;
// folding it into `ready` restores the false confidence this unit removes.
//
// ⚠ **NOTHING HERE INVENTS A WIRE SHAPE.** The gate is handed values a CALLER already extracted
// and never guesses where a field lives. `REQUIRED_METHODS` lists the methods THIS ADAPTER CALLS
// (grep `conn.request(` in `launch-spec.js` and `models.js`) — a statement about Dopl, which Dopl
// may make. `SUPPORTED_CLI` is UNPINNED until a real CLI measures it
// (`scripts/codex-app-server-schema.js`).

const PROTOCOL_STATE = Object.freeze({
  READY: 'ready', MISSING: 'missing', SIGNED_OUT: 'signed-out',
  UNSUPPORTED: 'unsupported-protocol', UNVERIFIED: 'unverified-protocol',
});

// ⚠ THE METHODS THIS ADAPTER ACTUALLY SENDS, sourced by grep: the thread/turn set in
// `launch-spec.js`, `model/list` in `models.js`. A method added to the adapter belongs on this
// list in the same change, or the gate passes a server that cannot run a session.
const REQUIRED_METHODS = Object.freeze([
  'initialize', 'thread/start', 'thread/resume',
  'turn/start', 'turn/steer', 'turn/interrupt', 'model/list',
]);

// ⚠ THE CRITICAL FACTS — what a handshake must have PRODUCED, stated as Dopl's requirement rather
// than as a path into a response.
const REQUIRED_FACTS = Object.freeze([
  Object.freeze({ key: 'threadId', why: 'a session cannot start without a thread handle' }),
  Object.freeze({ key: 'modelDefault', why: 'the model catalog must declare exactly one default' }),
]);

// 🔒 ⚠ **PINNED FROM A MEASUREMENT, 2026-09-22 — `codex-cli 0.155.1`, installed from the public
// `@openai/codex` package on this machine and captured by `npm run codex:schema`.** It was UNPINNED
// until then, because the machine that landed the gate had no CLI and a version written from
// memory is a guess wearing a measurement's costume.
//
// ⚠ **`min` ONLY, `max: null`, AND THAT ASYMMETRY IS THE HONEST ONE.** Below `min` is a CLI whose
// protocol this adapter has never been measured against — refuse it and say so. ABOVE it is the
// future, which has not happened yet: refusing it would strand operators on the day Codex ships a
// compatible release, and the METHOD check below already catches a genuinely incompatible one by
// naming the method that went missing. A `max` becomes honest the day a newer CLI is measured and
// found to break something; write it THEN, with what broke.
//
// ⚠ **RE-MEASURE, DO NOT EDIT BY HAND.** `npm run codex:schema` prints this exact line, and the
// live tier asserts the fixture's version equals the executing CLI's.
const SUPPORTED_CLI = Object.freeze({ min: '0.155.1', max: null, measuredFrom: '0.155.1' });

/** `"codex-cli 0.31.0"` → `[0, 31, 0]`. Returns `null` when no dotted number is present. */
function parseVersion(text) {
  const m = /(\d+)\.(\d+)(?:\.(\d+))?/.exec(String(text || ''));
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3] || 0)];
}

function compareVersion(a, b) {
  for (let i = 0; i < 3; i += 1) {
    if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) < (b[i] || 0) ? -1 : 1;
  }
  return 0;
}

/**
 * Is this CLI version inside the supported range? `{ ok, verdict, reason, detected, supported }`.
 * ⚠ `verdict` is `unpinned` while `SUPPORTED_CLI` holds no measured bound, and an unpinned gate is
 * `ok: true` — refusing every install on a range nobody measured is worse than not checking.
 */
function versionGate(version) {
  const detected = parseVersion(version);
  const supported = { min: SUPPORTED_CLI.min, max: SUPPORTED_CLI.max };
  if (!supported.min && !supported.max) {
    return { ok: true, verdict: 'unpinned', reason: '', detected: version || null, supported };
  }
  if (!detected) {
    return {
      ok: false,
      verdict: 'unreadable',
      reason: `Dopl could not read a version out of \`${version}\`.`,
      detected: version || null,
      supported,
    };
  }
  const min = supported.min ? parseVersion(supported.min) : null;
  const max = supported.max ? parseVersion(supported.max) : null;
  const refuse = (verdict, reason) => ({ ok: false, verdict, reason, detected: version || null, supported });
  if (min && compareVersion(detected, min) < 0) {
    return refuse('too-old', `Codex ${version} is older than the ${supported.min} this Dopl build supports. Upgrade the Codex CLI.`);
  }
  if (max && compareVersion(detected, max) > 0) {
    return refuse('too-new', `Codex ${version} is newer than the ${supported.max} this Dopl build was measured against. Update Dopl.`);
  }
  return { ok: true, verdict: 'supported', reason: '', detected: version || null, supported };
}

/**
 * Exactly one declared default in a model catalog.
 * ⚠ TOLERANT OVER THE KEY (`isDefault` / `is_default` / `default`), like `models.js › idsFrom` is
 * over the row shape: the spelling is not measured here. `rows == null` is UNVERIFIED, `rows: []`
 * is UNSUPPORTED — unknown is not empty.
 */
function catalogGate(rows) {
  if (rows == null) {
    return { ok: false, state: PROTOCOL_STATE.UNVERIFIED, reason: 'no model catalog was read', defaults: [] };
  }
  if (!Array.isArray(rows)) {
    return { ok: false, state: PROTOCOL_STATE.UNSUPPORTED, reason: 'the model catalog was not a list', defaults: [] };
  }
  const defaults = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const flag = row.isDefault !== undefined ? row.isDefault
      : (row.is_default !== undefined ? row.is_default : row.default);
    if (flag === true) defaults.push(row.id || row.model || row.name || '(unnamed)');
  }
  if (defaults.length === 1) return { ok: true, state: PROTOCOL_STATE.READY, reason: '', defaults };
  return {
    ok: false,
    state: PROTOCOL_STATE.UNSUPPORTED,
    reason: defaults.length === 0
      ? `the model catalog (${rows.length} models) declares no default`
      : `the model catalog declares ${defaults.length} defaults (${defaults.join(', ')}); exactly one is required`,
    defaults,
  };
}

/**
 * THE GATE. May Dopl report this Codex as connected?
 *
 * `input` — `{ version, methods, facts }`, all ALREADY EXTRACTED by the caller. `methods` is the
 * declared method names or `null` for "not declared"; `facts` is `{ threadId, modelDefault, … }`
 * measured during a handshake or `null` for "no handshake ran". ⚠ Unknown keys are IGNORED.
 * Returns `{ ok, state, reason, missingMethods, missingFacts, version }`; `ok` only for `ready`.
 */
function checkProtocol(input) {
  const inp = input || {};
  const version = versionGate(inp.version);
  if (!version.ok) {
    return {
      ok: false, state: PROTOCOL_STATE.UNSUPPORTED, reason: version.reason,
      missingMethods: [], missingFacts: [], version,
    };
  }

  const unverified = [];
  const missingMethods = [];
  if (inp.methods == null) {
    unverified.push('the app-server declared no method list, so Dopl could not verify it');
  } else if (!Array.isArray(inp.methods)) {
    return {
      ok: false, state: PROTOCOL_STATE.UNSUPPORTED,
      reason: 'the app-server\'s declared method list was not a list',
      missingMethods: REQUIRED_METHODS.slice(), missingFacts: [], version,
    };
  } else {
    const have = new Set(inp.methods.map((m) => String(m)));
    for (const need of REQUIRED_METHODS) if (!have.has(need)) missingMethods.push(need);
  }

  const missingFacts = [];
  if (inp.facts == null) {
    unverified.push('no handshake was run, so Dopl could not verify the response shapes');
  } else {
    for (const fact of REQUIRED_FACTS) {
      const value = inp.facts[fact.key];
      if (value === undefined || value === null || value === '') missingFacts.push(fact);
    }
  }

  if (missingMethods.length || missingFacts.length) {
    const parts = missingMethods.length ? [`it does not offer ${missingMethods.join(', ')}`] : [];
    for (const fact of missingFacts) parts.push(`it did not supply \`${fact.key}\` — ${fact.why}`);
    return {
      ok: false,
      state: PROTOCOL_STATE.UNSUPPORTED,
      reason: `This Codex speaks a protocol Dopl cannot drive: ${parts.join('; ')}.`,
      missingMethods, missingFacts, version,
    };
  }
  if (unverified.length) {
    return {
      ok: false,
      state: PROTOCOL_STATE.UNVERIFIED,
      reason: `Dopl has not verified this Codex: ${unverified.join('; ')}.`,
      missingMethods, missingFacts, version,
    };
  }
  return { ok: true, state: PROTOCOL_STATE.READY, reason: '', missingMethods, missingFacts, version };
}

module.exports = {
  PROTOCOL_STATE, REQUIRED_METHODS, REQUIRED_FACTS, SUPPORTED_CLI,
  checkProtocol, versionGate, catalogGate, parseVersion,
};
