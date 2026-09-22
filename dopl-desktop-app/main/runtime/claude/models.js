// THE MODEL ROSTER, AS A CAPABILITY.
//
// ⚠ `source: 'frozen'`, AND THE REASON IS DOCUMENTED IN THE TABLE ITSELF. The platform's own
// `supportedModels()` would answer authoritatively, but it needs a LIVE query — and the picker has
// to be usable before anything is running. So the roster is a table read off the bundled binary,
// dated, with an explicit rule that an unknown model gets NO denominator rather than a guessed
// one. A runtime whose roster is a live call declares `source: 'live'` and answers `models()` from
// the wire; nothing else about the seam changes.
//
// ⚠ THE TABLES HAVE NOT MOVED YET, AND THIS FILE SAYS SO RATHER THAN COPYING THEM. They are still
// `main/session-model.js`'s — the model-roster step of the port (design §4 step 5) is what brings
// them here, together with the six duplicated id vocabularies it has to collapse. Restating them
// now would create the seventh copy that step exists to remove, so this delegates instead. The
// ONE thing that is declared here and nowhere else is the descriptor data below.

// ⚠ **REQUIRED AT MODULE LOAD SINCE 2026-09-21 (U5), AND THAT IS A CHANGE OF KIND.** It was lazy
// (`const modelTable = () => require(…)`) for ONE reason: `session-model.js` carried a dead
// `require('./diag')`, and `diag.js` pulls `electron` — which `main/session-profiles.js`, a PURE
// module two suites evaluate standalone, may not transitively load. That dead line is gone, so the
// table is reachable at load, and the DESCRIPTOR below can finally declare this platform's own
// model vocabulary as data. That declaration is the whole point: before it, every shared storage
// module (`channel-prefs.js`, `agent-defaults.js`) and `session-engine.js` imported THIS RUNTIME'S
// enum directly and validated a CODEX pick against it.
// ⚠ STILL NOT A COPY. The tables remain `session-model.js`'s; this names them.
const modelTable = require('../../session-model');

// ── ⚠ THE DISPLAY NAMES (2026-09-21, U6) — WHY THIS RUNTIME NOW CARRIES ITS OWN LABELS ───────
//
// ⚠ **THE LABELS USED TO LIVE ONLY IN THE RENDERER, AND THAT IS WHAT MADE THEM EVERY RUNTIME'S.**
// `src/features/channels/lib/agent-models.ts` held four ids with four labels and FOUR SURFACES
// read it regardless of which runtime was selected — so picking Codex offered Fable. U6's fix is
// that every runtime delivers its OWN roster over one normalized contract
// (`main/runtime/model-catalog.js`), and a roster with no names is a picker that renders raw ids.
// Codex names its models on the wire (`model/list` → `displayName`); this one has no wire to ask,
// so the names are declared here, beside the ids they name.
//
// ⚠ **IT IS A TWIN, AND THE TWIN IS PINNED RATHER THAN TRUSTED.** The web file keeps the same
// table as the OLDER-DESKTOP FALLBACK (a desktop that predates the catalog sends none), exactly
// as `session-model.js › LAUNCH_MODEL_FALLBACK` is pinned against
// `agent-models.ts › AGENT_MODEL_FALLBACK` — the two trees cannot import each other.
// `test/runtime-model-catalog.test.mjs` READS the web file and fails when they disagree.
// ⚠ `short` IS THE GLANCE WORD a card chip renders; it is not a truncation rule.
const LABELS = {
  'claude-fable-5': { label: 'Fable 5', short: 'Fable' },
  'claude-opus-5': { label: 'Opus 5', short: 'Opus' },
  'claude-sonnet-5': { label: 'Sonnet 5', short: 'Sonnet' },
  'claude-haiku-4-5-20251001': { label: 'Haiku 4.5', short: 'Haiku' },
};

/** The offerable roster. ⚠ Unknown ids still render raw and round-trip — only the PICKS are closed. */
function models() {
  const table = modelTable;
  // ⚠ **THE DEFAULT IS THE PRODUCT'S BACK-FILL, NOT A MEASURED PLATFORM ANSWER, AND SAYING SO IS
  // THE POINT.** `session-model.js › LAUNCH_MODEL_FALLBACK` is the id Samuel chose on 2026-09-06
  // for a channel that never picked; "default" on this platform means NO `--model` argument and
  // nothing in either tree knows what the CLI resolves that to. So the catalog reports the id the
  // PRODUCT displays for an unset channel — which is what a picker's default marker means — and
  // the wire still carries no model until the operator picks one.
  const fallback = table.LAUNCH_MODEL_FALLBACK;
  return {
    source: 'frozen',
    // ⚠ THE CACHE KEY OF A TABLE IS THE BUILD IT SHIPPED IN. It never goes stale inside one
    // process, so a constant is the honest answer rather than `null` (which reads as "unkeyed").
    key: 'frozen',
    ids: table.MODEL_IDS.slice(),
    // The argv alias vocabulary. `[0]` is the fail-closed member and sets no model option at all,
    // i.e. the platform's own pick — which is what every session did before a picker existed.
    aliases: table.MODEL_CHOICES.slice(),
    // ── U6: the normalized entries `runtime/model-catalog.js` turns into a catalog. ⚠ ORDER IS
    // THE ORDER AN OPERATOR READS, and it is `MODEL_IDS`' own — most capable first, unchanged.
    models: table.MODEL_IDS.map((id) => ({
      id,
      label: (LABELS[id] && LABELS[id].label) || id,
      short: (LABELS[id] && LABELS[id].short) || null,
      isDefault: id === fallback,
      hidden: false,
      // ⚠ NO MODEL-SCOPED DIMENSIONS: this runtime declares `dimensions: null` below, so an empty
      // object here is the same statement made twice and cannot disagree with it.
      dimensions: {},
    })),
    defaultId: fallback,
    reason: '',
  };
}

// Descriptor half. ⚠ `defaultMeansAbsent: ''` is the absence-of-an-id convention the whole launch
// precedence chain rests on (`session-model.js › chainModel`): a link that names nothing this
// build knows STEPS ASIDE instead of spending the platform default and discarding the rest.
const descriptor = {
  source: 'frozen',
  // ⚠ null, not []. Reasoning effort is a second dimension only some runtimes have, and an empty
  // array here would render an empty control instead of no control (§3.2, hide-on-absent).
  dimensions: null,
  defaultMeansAbsent: '',
  // ⚠ false: this runtime carries the model through a resume by itself, so nothing re-stamps it.
  reStampOnResume: false,
  // ── ⚠ THE PICK RULE (2026-09-21, U5) — THIS RUNTIME'S MODEL VOCABULARY, AS DECLARED DATA ─────
  //
  // Before this block, `main/channel-prefs.js`, `main/agent-defaults.js` and `main/session-engine.js`
  // each imported `session-model.js` and validated EVERY runtime's model through THIS runtime's
  // frozen list. A Codex id therefore normalized to `'default'` in shared code and reached the
  // Codex launch spec as the literal string `default`. The fix is not a second list — it is moving
  // the ONE list behind the adapter that owns it, so `runtime/capability.js › storeModelPick` /
  // `› launchModelPick` can answer for any runtime without knowing a single vendor id.
  //
  // ⚠ TWO VOCABULARIES, AND THE SPLIT IS `session-model.js`'s, UNCHANGED. `stored` is what a UI
  // offers and a durable record keeps (FULL IDS — version-stable round-tripping for a select);
  // `accepted` additionally admits the ALIASES a launch may carry, and `canonical` is the lossy
  // id→alias seam that makes argv version-stable. `absent` is the value that means "no pick".
  // ⚠ `'default'` IS A LEGAL ACCEPTED VALUE AND MAPS TO `absent`, which is exactly what
  // `session-model.js › normalizeModel` answers for it today.
  pick: {
    kind: 'closed',
    stored: modelTable.MODEL_IDS.slice(),
    // MODEL_CHOICES[0] is `'default'` — the absence member — so it is deliberately NOT in
    // `accepted`: `launchModelPick` answers `absent` for anything outside the list anyway, and
    // listing it would make "an alias this build knows" and "no opinion" the same assertion.
    accepted: modelTable.MODEL_IDS.concat(modelTable.MODEL_CHOICES.slice(1)),
    canonical: modelTable.MODEL_IDS.reduce((m, id) => {
      m[id] = modelTable.aliasForModelId(id);
      return m;
    }, {}),
    absent: modelTable.MODEL_CHOICES[0],
    pattern: null, // closed rosters do not shape-check; membership IS the check
  },
  // ⚠ null, not {}: there is no model-scoped second dimension here, so nothing renders and nothing
  // is storable. `contract.js` refuses a descriptor that names a dimension it cannot back.
  dimensionOptions: null,
};

module.exports = { models, descriptor };
