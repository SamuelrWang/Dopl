// THE LAUNCH-SELECTION VOCABULARY — what a durable launch selection and a session's model stamp are
// validated against: each adapter's declared model pick rule and native launch dimensions. Shared
// core stores and stamps effective values and never reinterprets a vendor id.
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
 * The native launch dimensions this runtime declares and can spend, or `null` for none (the UI
 * renders no row; `null` and `{}` must not collapse). Each is `{ options, default, fallback }`,
 * derived from `toolMode.secondaryAxis` (containment: fallback `narrowest`) and
 * `models.dimensions` + `models.dimensionOptions` (model-scoped: fallback as declared). Codex's
 * granular approval categories are deliberately not a dimension: storing them is a product change.
 */
function nativeDimensions(descriptor) {
  const out = {};
  const sec = (descriptor && descriptor.toolMode && descriptor.toolMode.secondaryAxis) || null;
  if (sec && typeof sec.key === 'string' && sec.key && Array.isArray(sec.options) && sec.options.length) {
    out[sec.key] = {
      // Narrowest first: `[0]` is where an unrecognised containment value fail-closes.
      options: sec.options.map((o) => o && o.value).filter((v) => typeof v === 'string' && v),
      default: typeof sec.default === 'string' ? sec.default : null,
      fallback: 'narrowest',
    };
  }
  const dims = (descriptor && descriptor.models && descriptor.models.dimensions) || null;
  const declared = (descriptor && descriptor.models && descriptor.models.dimensionOptions) || null;
  if (Array.isArray(dims) && declared) {
    for (const key of dims) {
      const d = declared[key];
      if (!d || !Array.isArray(d.options) || !d.options.length) continue; // refused at registration
      out[key] = {
        options: d.options.slice(),
        default: typeof d.default === 'string' ? d.default : null,
        fallback: d.fallback === 'narrowest' ? 'narrowest' : 'absent',
      };
    }
  }
  return Object.keys(out).length ? out : null;
}

/**
 * Validate a stored/incoming native record against what this runtime declares → `{ value, review }`
 * (the record to keep, and the sentences an operator needs). Three cases that must not collapse:
 *   key absent     nothing stored, nothing said — the platform default applies;
 *   key unknown    dropped and reviewed;
 *   value unknown  fails closed in the dimension's own direction (`narrowest` for containment, never
 *                  the widest), and reviewed.
 */
function normalizeNative(descriptor, raw) {
  const dims = nativeDimensions(descriptor);
  const label = (descriptor && descriptor.label) || 'this runtime';
  const review = [];
  if (!dims) {
    if (raw && typeof raw === 'object' && !Array.isArray(raw) && Object.keys(raw).length) {
      review.push(`${label} declares no native launch settings, so ${Object.keys(raw).length} stored value(s) were dropped`);
    }
    return { value: {}, review: review };
  }
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const value = {};
  for (const key of Object.keys(src)) {
    if (!Object.prototype.hasOwnProperty.call(dims, key)) {
      review.push(`${label} has no native setting called "${key}", so it was dropped`);
    }
  }
  for (const key of Object.keys(dims)) {
    if (!Object.prototype.hasOwnProperty.call(src, key)) continue; // absent stays absent
    const dim = dims[key];
    const picked = typeof src[key] === 'string' ? src[key].trim() : '';
    if (!picked) continue; // an explicit clear is an absence, not a third state
    if (dim.options.indexOf(picked) !== -1) { value[key] = picked; continue; }
    if (dim.fallback === 'narrowest') {
      value[key] = dim.options[0];
      review.push(`${label} does not offer "${picked}" for ${key}; it fell back to the narrowest `
        + `setting, "${dim.options[0]}"`);
    } else {
      review.push(`${label} does not offer "${picked}" for ${key}; it was dropped and the `
        + 'platform default applies');
    }
  }
  return { value: value, review: review };
}

/**
 * A launcher's model pick as a real pick, or `''` for "no pick". The legacy word `'default'` is the
 * Claude lane's "no opinion", never a model id, so it reads as no pick on every runtime (RC-15).
 */
function pickOf(v) {
  const s = typeof v === 'string' ? v.trim() : '';
  return s === 'default' ? '' : s;
}

module.exports = {
  pickRule, launchModelPick, nativeDimensions, normalizeNative, pickOf,
};
