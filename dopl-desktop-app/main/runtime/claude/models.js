// THE MODEL ROSTER, AS A CAPABILITY — ⚠ `source: 'live'` SINCE 2026-09-22.
//
// ⚠ **IT WAS `'frozen'`, AND THE REASON IT GAVE WAS WRONG.** The header said the platform's own
// `supportedModels()` "needs a LIVE query" and the picker must work before anything runs. Both are
// true and neither forces a frozen table: `roster.js` starts the CLI with a prompt that never
// yields, reads `supportedModels()` off the handshake and stops it — no user message, no API
// request, no model turn (MEASURED). So a model Anthropic ships appears here the day the CLI
// offers it, with the CLI's own display name, and nothing in this tree has to change.
//
// ⚠ **THE FROZEN TABLE IS THE FALLBACK, AND ONLY WHEN THE LIVE READ FAILS.** `session-model.js ›
// MODEL_IDS` + `LABELS` below answer when the CLI cannot be started or does not answer — and the
// roster then says `stale: true` with a reason, which `model-catalog.js` turns into a `stale`
// catalog: the old ids still LABEL, they are not newly SELECTABLE, and the operator is told why.
//
// ⚠ **CACHED BY `<binary>@<sdk version>#<credential source>`.** The roster is per ACCOUNT (a
// signed-out CLI omits Fable — measured), so a sign-in or a swapped credential is a different
// key; an SDK upgrade is too. `rosterKey()` is SYNC so `model-catalog.js` can notice a moved key
// on an ordinary look and re-read without a timer.
//
// ⚠ ELECTRON-FREE AT LOAD. The loader (which requires `electron`) and the credential probe are
// reached lazily inside `defaultDeps`, so `main/session-profiles.js` — a PURE module two suites
// evaluate standalone — can still reach this adapter through the registry.

const modelTable = require('../../session-model');
const roster = require('./roster');

// ── THE FALLBACK'S DISPLAY NAMES — the web twin is `agent-models.ts › AGENT_MODELS` ──────────
// ⚠ PINNED, NOT TRUSTED: `test/runtime-model-catalog.test.mjs` reads the web file and fails when
// they disagree. Only the FALLBACK uses these; a live roster carries the CLI's own names.
const LABELS = {
  'claude-fable-5': { label: 'Fable 5', short: 'Fable' },
  'claude-opus-5': { label: 'Opus 5', short: 'Opus' },
  'claude-sonnet-5': { label: 'Sonnet 5', short: 'Sonnet' },
  'claude-haiku-4-5-20251001': { label: 'Haiku 4.5', short: 'Haiku' },
};

// ⚠ THE PICK GRAMMAR. The value becomes `--model <value>` on an argv array (no shell), so this is
// a SHAPE gate, not a roster check: an id, an alias, a `[1m]`-style suffix at the END only, and the
// separators Bedrock/Vertex ids use. No space, quote, newline or shell metacharacter; 120 chars is
// the column bound every model field in the schema carries.
const PICK_PATTERN = '^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,109}(\\[[A-Za-z0-9]{1,8}\\])?$';
const PICK_RE = new RegExp(PICK_PATTERN);

const legacyAliases = () => modelTable.MODEL_IDS.reduce((m, id) => {
  m[id] = modelTable.aliasForModelId(id);
  return m;
}, {});

/** The table this build shipped with, in the live roster's own shape. */
function frozenRoster(reason) {
  const fallback = modelTable.LAUNCH_MODEL_FALLBACK;
  const models = modelTable.MODEL_IDS.map((id) => {
    const alias = modelTable.aliasForModelId(id);
    return {
      id,
      value: alias,
      label: (LABELS[id] && LABELS[id].label) || id,
      short: (LABELS[id] && LABELS[id].short) || null,
      isDefault: id === fallback,
      hidden: false,
      aliases: [alias, roster.baseId(id)].filter((v, i, a) => v && v !== id && a.indexOf(v) === i),
      dimensions: {},
    };
  });
  return {
    source: 'live',
    key: 'frozen',
    ids: models.map((m) => m.id),
    models,
    defaultId: fallback,
    // ⚠ `stale` IS THE WHOLE STATEMENT: these ids are this build's memory, not the CLI's answer.
    stale: true,
    reason: reason || 'Dopl could not read Claude Code\'s model list, so it is showing the list this build shipped with.',
    truncated: false,
  };
}

// ── DEPENDENCIES (injectable for the suite) ───────────────────────────────────────────────────
function defaultDeps() {
  return {
    loadSdk: () => require('./loader').getSdk(),
    bin: () => require('./loader').resolveClaudeExecutable(),
    env: () => require('../../session-auth').withStoredCredential(require('./loader').buildScrubbedEnv()),
    credentialSource: () => {
      try { return String(require('../../session-auth').credentialState().source || 'none'); } catch (_) { return 'none'; }
    },
    // ⚠ THE PLATFORM BINARY'S PACKAGE, NOT THE SDK'S: the SDK's `exports` map does not export its
    // `package.json` (ERR_PACKAGE_PATH_NOT_EXPORTED, measured), and the binary is what answers.
    sdkVersion: () => {
      try {
        return String(require(`@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}/package.json`).version || '?');
      } catch (_) { return '?'; }
    },
    probe: roster.probe,
  };
}
let deps = defaultDeps();

let held = null; // { key, roster } — the last LIVE answer, never a fallback
let inflight = null; // { key, promise }

/** `<binary>@<sdk version>#<credential source>` — SYNC, so a moved key is noticed on a look. */
function rosterKey() {
  let bin = '?';
  try { bin = String(deps.bin() || '?'); } catch (_) { bin = '?'; }
  return `${bin}@${deps.sdkVersion()}#${deps.credentialSource()}`;
}

async function readLive(key) {
  const sdk = await deps.loadSdk();
  const options = { env: deps.env() };
  const bin = deps.bin();
  if (bin) options.pathToClaudeCodeExecutable = bin;
  const rows = await deps.probe({ sdk, options });
  return roster.rosterFrom(rows, {
    key,
    legacy: legacyAliases(),
    fallbackId: modelTable.LAUNCH_MODEL_FALLBACK,
    fallbackAlias: modelTable.aliasForModelId(modelTable.LAUNCH_MODEL_FALLBACK),
  });
}

/**
 * The offerable roster. ⚠ ASYNC and NEVER THROWS: a failed read answers the frozen table marked
 * `stale`, with the reason — never an empty list, never another runtime's.
 */
async function models() {
  const key = rosterKey();
  if (held && held.key === key) return held.roster;
  if (inflight && inflight.key === key) return inflight.promise;
  const promise = readLive(key)
    .then((live) => {
      if (!live.models.length) return frozenRoster(live.reason);
      held = { key, roster: live };
      return live;
    })
    .catch((err) => frozenRoster(`Dopl could not read Claude Code's model list (${(err && err.message) || 'unknown error'}), so it is showing the list this build shipped with.`))
    .finally(() => { if (inflight && inflight.promise === promise) inflight = null; });
  inflight = { key, promise };
  return promise;
}

/** The roster a SYNCHRONOUS caller resolves against: the live one when held, else the table. */
function current() {
  return (held && held.roster) || frozenRoster();
}

/**
 * THE `--model` ARGUMENT FOR A PICK — `{ ok, arg, id, reason }`, synchronous.
 *
 * ⚠ **A PICK LAUNCHES AS THE ROW IT NAMES, BY THAT ROW'S OWN `value`** — never squeezed through a
 * fixed alias list. Absent (or the legacy word `default`) is the PRODUCT fallback, resolved on the
 * same roster. ⚠ `ok: false` IS A REFUSAL WITH A SENTENCE — never a silent substitute.
 */
function resolveLaunchModel(value) {
  const r = current();
  const v = typeof value === 'string' ? value.trim() : '';
  if (!v || v === 'default') {
    const fb = roster.match(r.models, modelTable.LAUNCH_MODEL_FALLBACK)
      || roster.match(r.models, modelTable.aliasForModelId(modelTable.LAUNCH_MODEL_FALLBACK));
    return fb
      ? { ok: true, arg: fb.value, id: fb.id, reason: '' }
      : { ok: true, arg: modelTable.aliasForModelId(modelTable.LAUNCH_MODEL_FALLBACK), id: modelTable.LAUNCH_MODEL_FALLBACK, reason: '' };
  }
  // By exact id or alias only: `baseId` strips `[1m]`, so a long-context pick matched the short row
  // of the frozen table and resumed a 1M conversation on a 200k model (RC-01).
  const row = roster.matchExact(r.models, v);
  if (row) return { ok: true, arg: row.value, id: row.id, reason: '' };
  const offered = r.models.filter((m) => !m.hidden).map((m) => m.label || m.id).join(', ');
  return { ok: false, arg: '', id: '', reason: `Claude Code does not offer the model "${v}" on this machine${offered ? ` (it offers: ${offered})` : ''}.` };
}

/**
 * What `buildOptions` spends. ⚠ AN UNMATCHED VALUE THAT PASSES THE GRAMMAR IS SENT AS ITSELF: the
 * launch funnel already refused unknown picks with a sentence (`session-launch.js`), so what
 * reaches here unmatched is a RESUMED session's own recorded model, and that conversation runs on
 * exactly that model or fails visibly — never on a substitute.
 */
function launchArg(value) {
  const r = resolveLaunchModel(value);
  if (r.ok) return r.arg;
  const v = String(value).trim();
  return PICK_RE.test(v) ? v : resolveLaunchModel('').arg;
}

/** Drop the live cache. ⚠ For tests and an explicit re-probe; `inject` swaps the dependencies. */
function forget() { held = null; inflight = null; }
function inject(overrides) { deps = Object.assign(defaultDeps(), overrides || {}); forget(); }

// Descriptor half.
const descriptor = {
  source: 'live',
  // ⚠ null, not []: no second dimension renders here (the CLI's effort levels are not wired).
  dimensions: null,
  defaultMeansAbsent: '',
  reStampOnResume: false,
  // ── ⚠ THE PICK RULE IS `open` SINCE 2026-09-22 — IT WAS `closed` OVER THE FROZEN IDS ────────
  // A closed rule is a picker that can never offer a model this build predates, which is the
  // defect Samuel named. Storage keeps a SHAPE-CHECKED string (a durable record written while the
  // CLI answered must not be erased by a read taken while it does not); the live roster decides
  // what may be NEWLY SELECTED (the renderer) and what may LAUNCH (`session-launch.js` refuses
  // an unknown pick with a sentence).
  pick: {
    kind: 'open',
    accepted: null,
    canonical: null,
    absent: '',
    pattern: PICK_PATTERN,
  },
  dimensionOptions: null,
};

module.exports = {
  models, current, rosterKey, resolveLaunchModel, launchArg, frozenRoster, forget, inject,
  descriptor, LABELS, PICK_PATTERN,
};
