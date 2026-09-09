// WHICH ONTOLOGIES THIS SESSION REACHES, AND AT WHAT LEVEL (2026-09-09,
// `docs/specs/home-ontology.md` §4.9 / S5).
//
// ⚠ **THIS IS A COMPENSATING CONTROL, NOT A GATE.** INVARIANTS §4A says exactly
// that about the personal-reach lane, and reading it as a gate is how this
// becomes a leak: the FENCE is the ontology service's, and the `dopl_ontology`
// path inherits it through the HTTP routes. These lines exist so an agent knows
// what it may open and stops guessing — never so that omitting a line stops it.
//
// ⚠ IT BOUNDS FUTURE READS, NEVER CONTEXT ALREADY IN THE WINDOW (I7, the rule
// `knowledge/server/service-audience.ts › resolveAgentAudience` states and
// INVARIANTS §11 pins). A level that narrows mid-session narrows the NEXT call.
//
// ⚠ ITS OWN MODULE, not `prompt-framing-text.js`: that file's contract is that
// EVERY block in it is FIXED TEXT with nothing interpolated, which is what makes
// it safe to lift wholesale. These lines carry caller data, so they belong
// beside a sanitizer — the same seam `prompt-framing-template.js ›
// knowledgeLines` sits on, and the shape is copied from it deliberately.
//
// PURE: no electron / fs / path, so the truth tables `require` it directly.

const { idToken, sanitizeName } = require('./prompt-sanitize');

// The two rungs an agent can be told about. ⚠ `none` IS NOT ONE OF THEM and
// neither is an unknown word: this filter FAILS CLOSED, so a level the desktop
// does not recognise names no ontology at all rather than being printed raw.
const LEVELS = { view: 'VIEW', edit: 'EDIT' };

// ⚠ THE ID GOES THROUGH `idToken`, NOT `sanitizeName`, and the NAME through
// `sanitizeName`, NOT `idToken` — the same split `knowledgeLines` states: an id
// is spliced into a call the agent is told to make VERBATIM, so it must be id
// characters or nothing; a name is display text and must not be able to open a
// line of its own. ⚠ `idToken` STRIPS rather than refuses, so the drop below
// fires on the EMPTY RESULT — an entry whose id or name sanitizes to nothing is
// dropped WHOLE rather than printed with a blank in it.
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
 * ⚠ `[]` WHEN THERE IS NOTHING TO SAY, and that emptiness is the contract: every
 * lane no ontology reaches — every blank launch, every channel with no share —
 * must be BYTE-IDENTICAL to what it was before this module existed. A framing
 * block that emits a stray blank line when it has nothing to say is how
 * "byte-identical" quietly stops being true (`prompt-framing-startup.js` makes
 * the same promise for its own block).
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
    'These are your operator\'s ontologies, LENT into this channel — one object, not a copy, so an',
    'edit you make is seen by everyone it is lent to. The level above is enforced on the server and',
    'bounds what you may do NEXT; it does not retract anything already in this window. An ontology',
    'that is not named here is one this session does not reach: do not go looking for it.',
  ];
}

module.exports = { ontologyReachLines };
