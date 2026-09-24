// Which ontologies this session reaches, and at what level. A compensating control, not a gate: the
// fence is the ontology service's (INVARIANTS §4A), and a level bounds FUTURE calls only. Pure; its
// own module because these lines carry caller data (the text module is fixed text only).

const { idToken, sanitizeName } = require('./prompt-sanitize');
const { doplCall, GRANULAR } = require('./dopl-call-text');

// Fails closed: `none` or an unknown level names no ontology at all.
const LEVELS = { view: 'VIEW', edit: 'EDIT' };

// The id through `idToken` (spliced verbatim into a call), the name through `sanitizeName` (display);
// `idToken` strips rather than refuses, so an entry whose id comes out empty is dropped whole.
function reachable(ontologies) {
  return (Array.isArray(ontologies) ? ontologies : [])
    .map((o) => ({
      id: idToken(o && o.id),
      name: sanitizeName(o && o.name),
      level: LEVELS[o && o.level],
    }))
    .filter((o) => o.id && o.name && o.level);
}

// One line with the EXACT call. `ontology` is the tool's argument name (not respelled), and there is
// no `workspace` argument: `dopl_ontology` refuses it; the ontology id resolves its own container.
// The granular tool publishes no `ontology` (the map op never read it) and its strict schema refuses
// one, so that spelling names the id beside the call instead.
function ontologyLine(o, set) {
  const call = set === GRANULAR
    ? `${doplCall(set, 'ontology.map')} (id "${o.id}")`
    : doplCall(set, 'ontology.map', `ontology "${o.id}"`);
  const verb =
    o.level === 'EDIT'
      ? 'you may also write to it with the write ops.'
      : 'READ ONLY: a write to it is refused, and that refusal is the fence working.';
  return `- "${o.name}" (${o.level}): read it with ${call}; ${verb}`;
}

/**
 * The block, with its own leading blank line; `[]` when nothing is reached, so that turn stays
 * byte-identical.
 * @param {object} ctx the session context; reads `ctx.ontologies`
 */
function ontologyReachLines(ctx) {
  const list = reachable(ctx && ctx.ontologies);
  if (!list.length) return [];
  return [
    '',
    'ONTOLOGIES YOU CAN REACH IN THIS CHANNEL:',
    ...list.map((o) => ontologyLine(o, ctx.toolSet)),
    'These are your operator\'s ontologies, LENT into this channel as one row, not a copy, so an',
    'edit you make is seen by everyone it is lent to. The level above is enforced on the server and',
    'bounds what you may do NEXT; it does not retract anything already in this window. An ontology',
    'that is not named here is one this session does not reach: do not go looking for it.',
  ];
}

module.exports = { ontologyReachLines };
