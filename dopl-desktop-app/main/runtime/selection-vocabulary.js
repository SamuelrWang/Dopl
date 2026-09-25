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

module.exports = {
  pickRule, launchModelPick, pickOf,
};
