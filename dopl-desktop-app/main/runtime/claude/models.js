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

/** The offerable roster. ⚠ Unknown ids still render raw and round-trip — only the PICKS are closed. */
function models() {
  const table = modelTable;
  return {
    source: 'frozen',
    ids: table.MODEL_IDS.slice(),
    // The argv alias vocabulary. `[0]` is the fail-closed member and sets no model option at all,
    // i.e. the platform's own pick — which is what every session did before a picker existed.
    aliases: table.MODEL_CHOICES.slice(),
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
