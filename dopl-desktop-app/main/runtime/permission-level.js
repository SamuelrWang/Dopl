// PERMISSION LEVELS — the one operator control (Ask / Auto / Full) and the single source of truth for
// what each level means on each runtime. The meaning lives in each adapter's `toolMode.levels`
// (its own words: a tool mode plus any containment value); this module only orders and reads it.
// Requires only the capability layer, so core, the contract and the selection shape can all reach it.

const capability = require('./capability');

/** Narrowest first: `[0]` is the fail-closed level. */
const LEVELS = Object.freeze(['ask', 'auto', 'full']);

/** A level word, or `''` for anything else. */
const normalizeLevel = (v) => (LEVELS.indexOf(v) === -1 ? '' : v);

const levelTable = (d) => (d && d.toolMode && d.toolMode.levels) || {};

/** The containment axis a level may pin (`toolMode.secondaryAxis`), or null. */
function containmentAxis(d) {
  const sec = (d && d.toolMode && d.toolMode.secondaryAxis) || null;
  if (!sec || typeof sec.key !== 'string' || !Array.isArray(sec.options)) return null;
  return { key: sec.key, options: sec.options.map((o) => o && o.value), default: sec.default };
}

/**
 * `{ tools, native, label }` for a level on this runtime. An unknown level reads as the narrowest.
 * The label is the entry's own, else the tool option's (the runtime's name for that setting).
 */
function levelSettings(d, level) {
  const e = levelTable(d)[normalizeLevel(level) || LEVELS[0]] || {};
  const option = ((d && d.toolMode && d.toolMode.options) || []).find((o) => o && o.value === e.tools);
  return {
    tools: e.tools || capability.narrowestToolMode(d),
    native: { ...(e.native || {}) },
    label: e.label || (option && option.label) || '',
  };
}

// Per-axis index, narrowest = 0; an absent containment value is the platform default.
function rank(d, tools, native) {
  const out = [capability.toolModes(d).indexOf(capability.normalizeToolMode(d, tools))];
  const axis = containmentAxis(d);
  if (axis) {
    const v = native && typeof native === 'object' ? native[axis.key] : undefined;
    const at = axis.options.indexOf(v == null || v === '' ? axis.default : v);
    out.push(at === -1 ? 0 : at);
  }
  return out;
}

const atMost = (a, b) => a.every((v, i) => v <= b[i]);

/** The widest level this runtime pair meets on every axis; the narrowest when it meets none. */
function levelOf(d, tools, native) {
  const have = rank(d, tools, native);
  for (let i = LEVELS.length - 1; i > 0; i -= 1) {
    const s = levelSettings(d, LEVELS[i]);
    if (atMost(rank(d, s.tools, s.native), have)) return LEVELS[i];
  }
  return LEVELS[0];
}

/** The native words of a pair, tool mode first: `never/danger-full-access`, `bypass`. */
function settingText(d, tools, native) {
  const axis = containmentAxis(d);
  const v = axis && native && typeof native === 'object' ? native[axis.key] : '';
  return v ? `${tools}/${v}` : String(tools || '');
}

/**
 * An asked Axis-A word in this runtime's terms: a level becomes that level's tool mode; a native
 * word this runtime offers stays itself; anything else is `''` (not applied).
 */
function toolWordFor(d, asked) {
  if (normalizeLevel(asked)) return levelSettings(d, asked).tools;
  return capability.toolModes(d).indexOf(asked) === -1 ? '' : asked;
}

/** Every reason this descriptor's level table may not register. Empty array => it may. */
function levelProblems(d) {
  const id = (d && d.id) || '(unknown)';
  const table = levelTable(d);
  const modes = capability.toolModes(d);
  const axis = containmentAxis(d);
  const problems = [];
  let prior = null;
  for (const level of LEVELS) {
    const e = table[level];
    if (!e || typeof e !== 'object') { problems.push(`${id}: toolMode.levels.${level} is missing`); continue; }
    if (modes.indexOf(e.tools) === -1) problems.push(`${id}: toolMode.levels.${level}.tools "${e.tools}" is not a declared tool mode`);
    for (const key of Object.keys(e.native || {})) {
      if (!axis || key !== axis.key || axis.options.indexOf(e.native[key]) === -1) {
        problems.push(`${id}: toolMode.levels.${level}.native.${key} is not a declared containment value`);
      }
    }
    if (!levelSettings(d, level).label) problems.push(`${id}: toolMode.levels.${level} has no label`);
    const r = rank(d, e.tools, e.native);
    // A wider level may never be narrower on any axis, or "Full" could run tighter than "Auto".
    if (prior && !atMost(prior, r)) problems.push(`${id}: toolMode.levels.${level} is narrower than the level below it`);
    prior = r;
  }
  return problems;
}

module.exports = {
  LEVELS, normalizeLevel, levelSettings, levelOf, settingText, toolWordFor, levelProblems,
};
