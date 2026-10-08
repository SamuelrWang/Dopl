// THE MODEL-PICK VOCABULARY — what a session's model stamp is validated against: each adapter's
// declared model pick rule. Shared core stamps effective values and never reinterprets a vendor id.
// Requires nothing, so `session-profiles.js` (evaluated standalone by two suites) can reach it.

/** The pick rule a descriptor declares, or `null` when it declares none. */
const pickRule = (d) => (d && d.models && d.models.pick) || null;

function matchesPattern(rule, value) {
  if (typeof rule.pattern !== 'string' || !rule.pattern) return false;
  try {
    return new RegExp(rule.pattern).test(value);
  } catch (_err) {
    return false; // an unparseable pattern admits nothing, never "anything goes"
  }
}

/** The value a SESSION is stamped with at spawn: the pick if it passes the shape gate, else the
 *  runtime's own "no pick" member. The shape gate matters: the value becomes a launch argument. */
function launchModelPick(descriptor, value) {
  const rule = pickRule(descriptor);
  if (!rule) return '';
  const absent = typeof rule.absent === 'string' ? rule.absent : '';
  const v = typeof value === 'string' ? value.trim() : '';
  if (!v) return absent;
  return matchesPattern(rule, v) ? v : absent;
}

/**
 * A launcher's model pick as a real pick, or `''` for "no pick". The legacy word `'default'` is the
 * Claude lane's "no opinion", never a model id, so it reads as no pick on every runtime (RC-15).
 */
function pickOf(v) {
  const s = typeof v === 'string' ? v.trim() : '';
  return s === 'default' ? '' : s;
}

const DIMENSION_KEY = /^[A-Za-z][A-Za-z0-9_]{0,31}$/;

/**
 * A launcher's per-model dimension picks (`{ reasoningEffort: 'high' }`) coerced against this runtime's
 * declared vocabulary: only declared dimensions, and only values its `dimensionOptions` accept — a fixed
 * list's member, or a LIVE dimension's alphabet (`pattern`). Anything else is DROPPED (the declared
 * `fallback: 'absent'`: no field, the platform picks). Whether the chosen MODEL offers the value is the
 * live catalog's question (`session-launch.js`). Pure; `{}` for none.
 */
function launchDimensionPicks(descriptor, raw) {
  const models = (descriptor && descriptor.models) || {};
  const dims = Array.isArray(models.dimensions) ? models.dimensions : [];
  const opts = models.dimensionOptions || {};
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const key of dims) {
    if (!DIMENSION_KEY.test(key)) continue;
    const v = typeof raw[key] === 'string' ? raw[key].trim() : '';
    const rule = opts[key];
    if (!v || !rule) continue;
    const ok = rule.live === true
      ? typeof rule.pattern === 'string' && new RegExp(rule.pattern).test(v)
      : Array.isArray(rule.options) && rule.options.some((o) => (typeof o === 'string' ? o : o && o.value) === v);
    if (ok) out[key] = v;
  }
  return out;
}

module.exports = {
  pickRule, launchModelPick, launchDimensionPicks, pickOf,
};
