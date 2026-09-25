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

/** The approval reviewer a level may add (`toolMode.reviewer`: `{ key, value, mode }`), or null. */
function reviewerAxis(d) {
  const r = (d && d.toolMode && d.toolMode.reviewer) || null;
  return r && typeof r.key === 'string' && typeof r.value === 'string' && typeof r.mode === 'string' ? r : null;
}
// The reviewer runs only beside the tool mode it serves (`runtime/codex/launch-spec.js › nativePair`).
const hasReviewer = (r, tools, native) => !!r && tools === r.mode && !!native && typeof native === 'object' && native[r.key] === r.value;

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

// Per-axis index, narrowest = 0; an absent containment value is the platform default. The reviewer
// axis is met by carrying it or by a tool mode wider than the one it serves (`never` asks nobody).
function rank(d, tools, native) {
  const modes = capability.toolModes(d);
  const out = [modes.indexOf(capability.normalizeToolMode(d, tools))];
  const axis = containmentAxis(d);
  if (axis) {
    const v = native && typeof native === 'object' ? native[axis.key] : undefined;
    const at = axis.options.indexOf(v == null || v === '' ? axis.default : v);
    out.push(at === -1 ? 0 : at);
  }
  const rev = reviewerAxis(d);
  if (rev) out.push(hasReviewer(rev, modes[out[0]], native) || out[0] > modes.indexOf(rev.mode) ? 1 : 0);
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

/** The native words of a pair, tool mode first: `never/danger-full-access`, `bypass`, `on-request/workspace-write/guardian_subagent`. */
function settingText(d, tools, native) {
  const axis = containmentAxis(d);
  const rev = reviewerAxis(d);
  const v = axis && native && typeof native === 'object' ? native[axis.key] : '';
  return [tools || '', v, hasReviewer(rev, tools, native) ? rev.value : ''].filter(Boolean).join('/');
}

/** `{ level, label, setting }` for a native pair: the level it meets, that level's name, its own words. */
function describe(d, tools, native) {
  const level = levelOf(d, tools, native);
  return { level, label: levelSettings(d, level).label, setting: settingText(d, tools, native) };
}

/** Every level as this runtime applies it, `{ [level]: { label, setting } }` — what the UI renders. */
function levelTableFor(d) {
  const out = {};
  for (const level of LEVELS) {
    const s = levelSettings(d, level);
    out[level] = { label: s.label, setting: settingText(d, s.tools, s.native) };
  }
  return out;
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
    const rev = reviewerAxis(d);
    for (const key of Object.keys(e.native || {})) {
      if (rev && key === rev.key && e.native[key] === rev.value) continue;
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
  LEVELS, levelSettings, levelOf, settingText, describe, levelTableFor, toolWordFor, levelProblems,
};
