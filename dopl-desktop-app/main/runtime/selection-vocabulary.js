// THE LAUNCH-SELECTION VOCABULARY — what a DURABLE LAUNCH SELECTION is validated against.
//
// ⚠ §1 SPLIT OUT OF `capability.js` (2026-09-21, U5). That file answers what an ABSENT capability
// means to a CONTROL — hide it almost everywhere, refuse an action in four places. This one
// answers a different question with a different clock: which model vocabularies exist, which
// native launch dimensions an adapter may declare, and what a stored value that none of them
// covers falls back to. `capability.js` re-exports every name below, so no caller moved.
//
// ⚠ IT REQUIRES NOTHING. Pure functions over frozen descriptors, like its parent — so it cannot
// cycle, and `main/session-profiles.js` (a PURE module two suites evaluate standalone) can keep
// reaching the registry without pulling `electron` or spawning anything.

// ── THE MODEL PICK + THE NATIVE LAUNCH DIMENSIONS (2026-09-21, U5) ───────────────────────────
//
// ⚠ **WHY THESE ARE HERE AND NOT IN STORAGE.** `main/channel-prefs.js`, `main/agent-defaults.js`
// and `main/session-engine.js` each imported `main/session-model.js` — the DEFAULT runtime's
// frozen id table — and validated EVERY runtime's model through it. A Codex id therefore
// normalized to `'default'` in shared code and arrived at the Codex launch spec as the literal
// string `default`. The rule U5 draws is: **shared core stores and stamps effective values and
// never reinterprets a vendor id**, so the vocabulary moved into each adapter's own descriptor and
// the interpretation of it lives in this module, beside the other place `null` is interpreted.
//
// ⚠ `storeModelPick` — what a DURABLE record could keep — IS DELETED (2026-09-23): no launch
// selection stores a model any more (Samuel: *"We don't need a pin model in the settings"*).
// `launchModelPick` — what a SESSION is stamped with — is the one model question left here.

/** The pick rule a descriptor declares, or `null` when it declares none. */
const pickRule = (d) => (d && d.models && d.models.pick) || null;

function matchesPattern(rule, value) {
  if (typeof rule.pattern !== 'string' || !rule.pattern) return false;
  try {
    return new RegExp(rule.pattern).test(value);
  } catch (_err) {
    return false; // an unparseable pattern stores nothing — never "anything goes"
  }
}

/**
 * The value a SESSION is stamped with at spawn, or the runtime's own "no pick" member.
 *
 * ⚠ IT ACCEPTS BOTH OF A CLOSED RUNTIME'S VOCABULARIES AND ANSWERS IN EXACTLY ONE. A caller
 * holding a full id (a durable record) and one holding an alias (a per-session picker) must not
 * have to know which one the adapter's launch spec wants — that is how a value reaches argv
 * un-coerced.
 */
function launchModelPick(descriptor, value) {
  const rule = pickRule(descriptor);
  if (!rule) return '';
  const absent = typeof rule.absent === 'string' ? rule.absent : '';
  const v = typeof value === 'string' ? value.trim() : '';
  if (!v) return absent;
  if (rule.kind === 'closed') {
    const canonical = rule.canonical || {};
    if (Object.prototype.hasOwnProperty.call(canonical, v)) return canonical[v];
    const accepted = Array.isArray(rule.accepted) ? rule.accepted : [];
    return accepted.indexOf(v) === -1 ? absent : v;
  }
  return matchesPattern(rule, v) ? v : absent;
}

/**
 * The NATIVE launch dimensions this runtime declares AND can spend, or `null` for "no such
 * concept". Each entry is `{ options, default, fallback }` with `fallback` one of:
 *   `'narrowest'`  an unrecognised value resolves to `options[0]` — the CONTAINMENT direction
 *   `'absent'`     an unrecognised value is DROPPED, i.e. the platform's own default
 *
 * ⚠ DERIVED FROM WHAT IS ALREADY DECLARED, NOT RESTATED. The secondary containment axis is
 * `toolMode.secondaryAxis` (the row the UI renders) and the model-scoped dimensions are
 * `models.dimensions` + `models.dimensionOptions`. A second list here would be a mirror to drift,
 * which is the failure `contract.js › mirrorProblems` exists for.
 * ⚠ `null` AND `{}` MUST NOT COLLAPSE (§11 — UNKNOWN is not EMPTY): `null` says this runtime has
 * no native launch dimension at all and the UI renders NO row; an empty object cannot occur,
 * because a dimension with no options refuses registration.
 * ⚠ WHAT IS DELIBERATELY ABSENT: Codex's GRANULAR APPROVAL CATEGORIES. Their structured launch
 * shape is measured now, and the adapter spends the single `granular` mode as all five categories
 * asking. What this shared record does not yet declare is a per-category persistence contract.
 * A dimension declared here becomes a storable setting, so adding five toggles is a separate
 * end-to-end product change rather than a descriptor-only edit.
 */
function nativeDimensions(descriptor) {
  const out = {};
  const sec = (descriptor && descriptor.toolMode && descriptor.toolMode.secondaryAxis) || null;
  if (sec && typeof sec.key === 'string' && sec.key && Array.isArray(sec.options) && sec.options.length) {
    out[sec.key] = {
      // ⚠ NARROWEST FIRST, the same load-bearing order `toolMode.options` carries: `[0]` is where
      // an unrecognised containment value fail-closes.
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
 * Validate a stored/incoming native record against what this runtime declares.
 *
 * Answers `{ value, review }` — the record to keep, and the sentences an operator needs.
 *
 * ⚠ THE THREE CASES ARE THREE DIFFERENT ANSWERS AND MUST NOT COLLAPSE:
 *   KEY ABSENT      nothing is stored and nothing is said. The platform's own default applies,
 *                   which is what every session did before the control existed.
 *   KEY UNKNOWN     the key is DROPPED and the drop is REVIEWED. A renderer one version ahead
 *                   cannot smuggle a dimension this build cannot spend into a durable record.
 *   VALUE UNKNOWN   the dimension fails closed in its own declared direction — `narrowest` for
 *                   containment, `absent` for a model dimension — and the fall is REVIEWED.
 *                   ⚠ NEVER the widest and never the platform default on a CONTAINMENT axis: the
 *                   plan's scope boundary is explicit that a partially migrated value resolves to
 *                   the narrowest supported behaviour and surfaces a recoverable state.
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

module.exports = {
  pickRule, launchModelPick, nativeDimensions, normalizeNative,
};
