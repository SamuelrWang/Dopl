// THE CATALOG'S PURE READERS — what a pick names, what a model offers, and whether a catalog can vouch.
// Split from `model-catalog.js` (500-line cap, 2026-10-08) and re-exported there; requires nothing stateful,
// so the cache module and every reader share one statement of each rule.

const { pickOf } = require('./selection-vocabulary');
const { STATUS } = require('./catalog-status');

const str = (v) => (typeof v === 'string' ? v.trim() : '');

/** The catalog entry a pick names — its `id`, else one of its `aliases`. `null` when none does. */
function findModel(catalog, pick) {
  const v = str(pick);
  const models = (catalog && Array.isArray(catalog.models)) ? catalog.models : [];
  if (!v) return null;
  return models.find((m) => m.id === v)
    || models.find((m) => Array.isArray(m.aliases) && m.aliases.indexOf(v) !== -1)
    || null;
}

/** PURE: the dimension `picks` the launched `model` offers on this catalog (`{}` when none). A catalog that
 *  cannot vouch DROPS them (final review L5): a value no read proved this model offers could fail the turn
 *  on a platform that rejects it, so the platform picks its own default instead. A model with no entry is
 *  read as the catalog's default model. */
function offeredDimensions(catalog, model, picks) {
  const asked = picks && typeof picks === 'object' ? picks : {};
  if (!Object.keys(asked).length) return {};
  if (!vouches(catalog)) return {};
  const entry = findModel(catalog, model) || catalog.models.find((m) => m.id === catalog.defaultId) || null;
  const out = {};
  for (const key of Object.keys(asked)) {
    const dim = entry && entry.dimensions && entry.dimensions[key];
    if (dim && dim.options.some((o) => o.value === asked[key])) out[key] = asked[key];
  }
  return out;
}

/** Can this catalog vouch for a model's presence OR absence? Only a READY read can (RC-03). */
function vouches(catalog) {
  return !!catalog && catalog.status === STATUS.READY && Array.isArray(catalog.models) && catalog.models.length > 0;
}

/** Does this catalog prove `id` is offered? */
function offers(catalog, id) {
  return vouches(catalog) && !!findModel(catalog, id);
}

/**
 * Why a launch naming `pick` is refused, or `null`. An unknown model is refused with a sentence,
 * never swapped. Only a catalog that vouches can refuse ("could not read the list" is not "that
 * model does not exist"); no pick (absent / `'default'`) is never refused.
 */
function modelRefusal(catalog, pick, label) {
  const v = pickOf(pick);
  if (!v || !vouches(catalog)) return null;
  if (findModel(catalog, v)) return null;
  return notOfferedSentence(label, v, catalog.models);
}

/** The refusal sentence for a pick `models` lacks, listing what is offered (hidden rows omitted). */
function notOfferedSentence(label, pick, models) {
  const offered = (models || []).filter((m) => !m.hidden).map((m) => m.label || m.id).join(', ');
  return `${label || 'This runtime'} does not offer the model "${pick}" on this machine`
    + (offered ? ` — it offers: ${offered}` : '') + '.';
}

module.exports = { findModel, offeredDimensions, vouches, offers, modelRefusal, notOfferedSentence };
