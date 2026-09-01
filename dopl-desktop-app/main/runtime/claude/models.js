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

const modelTable = () => require('../../session-model');

/** The offerable roster. ⚠ Unknown ids still render raw and round-trip — only the PICKS are closed. */
function models() {
  const table = modelTable();
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
};

module.exports = { models, descriptor };
