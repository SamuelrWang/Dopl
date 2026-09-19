// WHICH ONTOLOGIES THIS SESSION REACHES, AND AT WHAT LEVEL (2026-09-09,
// `docs/specs/home-ontology.md` §4.9 / S5).
//
// ⚠ **THIS IS A COMPENSATING CONTROL, NOT A GATE** (INVARIANTS §4A). The FENCE
// is the ontology service's, inherited by `dopl_ontology` through the HTTP
// routes. These lines exist so an agent knows what it may open and stops guessing
// — never so that omitting a line stops it.
//
// ⚠ IT BOUNDS FUTURE READS, NEVER CONTEXT ALREADY IN THE WINDOW (I7, INVARIANTS
// §11): a level that narrows mid-session narrows the NEXT call.
//
// ⚠ ITS OWN MODULE, not `prompt-framing-text.js`, whose contract is that EVERY
// block is FIXED TEXT with nothing interpolated. These lines carry caller data,
// so they sit beside a sanitizer — `prompt-framing-template.js › knowledgeLines`'
// seam, copied deliberately.
//
// PURE: no electron / fs / path, so the truth tables `require` it directly.

const { idToken, sanitizeName } = require('./prompt-sanitize');

// The two rungs an agent can be told about. ⚠ `none` IS NOT ONE OF THEM and
// neither is an unknown word: this filter FAILS CLOSED, so a level the desktop
// does not recognise names no ontology at all rather than being printed raw.
const LEVELS = { view: 'VIEW', edit: 'EDIT' };

// ⚠ THE ID GOES THROUGH `idToken` AND THE NAME THROUGH `sanitizeName`, never the
// other way (`knowledgeLines`' split): an id is spliced VERBATIM into a call the
// agent is told to make, a name is display text that must not open a line of its
// own. ⚠ `idToken` STRIPS rather than refuses, so the filter below fires on the
// EMPTY RESULT and drops such an entry WHOLE.
function reachable(ontologies) {
  return (Array.isArray(ontologies) ? ontologies : [])
    .map((o) => ({
      id: idToken(o && o.id),
      name: sanitizeName(o && o.name),
      level: LEVELS[o && o.level],
      workspaceId: idToken(o && o.workspaceId),
    }))
    .filter((o) => o.id && o.name && o.level);
}

// One ontology's line: what it is called, what this session may do with it, and
// the EXACT call. ⚠ The `workspace` clause is printed only when the id is known
// — `dopl_ontology` takes `workspace=` on every op (INVARIANTS §10), and a call
// shape with a blank argument in it is a call the agent cannot make.
// ⚠ `cluster "<id>"` IS THE ARGUMENT NAME, NOT THE READER'S WORD. The 2026-09-11
// vocabulary ruling (INVARIANTS §4A) respells every string a person or an agent
// READS — but this one is a CALL SHAPE, and `dopl_ontology`'s parameter is
// `cluster`. Respelling it hands the agent a call it cannot make.
function ontologyLine(o) {
  const at = o.workspaceId
    ? `cluster "${o.id}", workspace "${o.workspaceId}"`
    : `cluster "${o.id}"`;
  const verb =
    o.level === 'EDIT'
      ? 'you may also write to it with the write ops.'
      : 'READ ONLY — a write to it is refused, and that refusal is the fence working.';
  return `- "${o.name}" (${o.level}) — read it with mcp__dopl__dopl_ontology op "map", ${at}; ${verb}`;
}

/**
 * The ONTOLOGY REACH block, as plain lines the caller splices into a turn.
 *
 * ⚠ `[]` WHEN THERE IS NOTHING TO SAY, and that emptiness is the contract: a
 * lane no ontology reaches must be BYTE-IDENTICAL to the turn before this module
 * existed, so not even a stray blank line (`prompt-framing-template.js` makes the
 * same promise).
 * ⚠ IT EMITS ITS OWN LEADING BLANK LINE when it emits anything, so the splice
 * site is exactly one line of assembly.
 *
 * @param {object} ctx the session context; reads `ctx.ontologies`
 */
function ontologyReachLines(ctx) {
  const list = reachable(ctx && ctx.ontologies);
  if (!list.length) return [];
  return [
    '',
    'ONTOLOGIES YOU CAN REACH IN THIS CHANNEL:',
    ...list.map(ontologyLine),
    'These are your operator\'s ontologies, LENT into this channel — one row, not a copy, so an',
    'edit you make is seen by everyone it is lent to. The level above is enforced on the server and',
    'bounds what you may do NEXT; it does not retract anything already in this window. An ontology',
    'that is not named here is one this session does not reach: do not go looking for it.',
  ];
}

module.exports = { ontologyReachLines };
