// THE GRANULAR DOPL TOOLS (DMP-013), as the server's manifest binds them to legacy calls.
//
// `dopl-tool-table.json` is GENERATED from `packages/mcp-server/src/tool-manifest.ts` and pinned
// byte-for-byte by that package's `desktop-tool-table.test.ts`; nothing here restates a binding.
// A granular call names ONE job of a legacy tool (`dopl_read_channel` = `dopl_channel` op "read"),
// so `mcp-tool-names.js › canonicalDoplCall` rewrites it to that legacy call before the gate and
// every desktop list keeps reading legacy keys. A LEAF (the JSON only): `mcp-tool-names.js`,
// `session-dopl-tools.js` and the prompt renderer all read it.

const TABLE = require('./dopl-tool-table.json');

const own = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

const ROWS = Object.freeze(Object.fromEntries(TABLE.tools.map((t) => [t.name, Object.freeze(t)])));
const GRANULAR_NAMES = Object.freeze(Object.keys(ROWS));

/** The row for a bare tool name, or null (own keys only: a name is caller-supplied). */
function granularRow(short) {
  return typeof short === 'string' && own(ROWS, short) ? ROWS[short] : null;
}

/** `dopl_channel:rooms.open` → `{ tool: 'dopl_channel', op: 'rooms', action: 'open' }`. */
function parseBinding(key) {
  const colon = key.indexOf(':');
  if (colon < 0) return { tool: key, op: undefined, action: undefined };
  const [op, action] = key.slice(colon + 1).split('.');
  return { tool: key.slice(0, colon), op, action };
}

/** Each job as [selector value, binding key]; the value is null for a one-job row. */
function jobsOf(row) {
  return typeof row.bind === 'string' ? [[null, row.bind]] : Object.entries(row.bind);
}

/** Every binding key a row can run. */
function bindingsOf(row) {
  return jobsOf(row).map(([, key]) => key);
}

/**
 * The job a call picks: `{ key }` for a bound job, `{ pulled: job }` for a published-resource job,
 * or null when the selector names no job (an absent one takes the row's default, if it has one).
 */
function jobOf(row, input) {
  if (typeof row.bind === 'string') return { key: row.bind };
  const raw = input[row.select];
  const job = raw === undefined ? row.default : raw;
  if (typeof job !== 'string') return null;
  if (own(row.bind, job)) return { key: row.bind[job] };
  return (row.pulled || []).indexOf(job) !== -1 ? { pulled: job } : null;
}

/** Granular names every one of whose bound legacy tools is in `shorts` (a Set of bare legacy names). */
function namesBoundWithin(shorts, onlyReads) {
  return GRANULAR_NAMES.filter((name) => (!onlyReads || ROWS[name].read)
    && bindingsOf(ROWS[name]).every((key) => shorts.has(parseBinding(key).tool)));
}

/** Granular names with SOME bound legacy tool in `shorts`: the server's offer for a profile (`withGranularTools`). */
function namesTouching(shorts) {
  return GRANULAR_NAMES.filter((name) => bindingsOf(ROWS[name]).some((key) => shorts.has(parseBinding(key).tool)));
}

module.exports = {
  GRANULAR_NAMES, granularRow, parseBinding, jobsOf, bindingsOf, jobOf, namesBoundWithin, namesTouching,
};
