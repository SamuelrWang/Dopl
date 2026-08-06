// THE HANDLE POOL a session pill is named from — the main-process COPY of
// `src/features/channels/server/agent-names.ts`.
//
// WHY A COPY, stated plainly so the next agent does not "de-duplicate" it. The
// canonical module is TypeScript in the web tree; this process is CommonJS with no
// build step (`dopl-desktop-app/` is inert for the Vercel build — nothing bundles
// it, nothing transpiles it), so it cannot import that file at all. The three
// alternatives were each worse:
//
//   • name in the RENDERER, which can import the TS. A name would then be a fact
//     about one window rather than about the session, so it would differ between
//     the SPA and the tray, change on reload, and be unavailable to rollback §3.5's
//     "what is flint doing?" MCP read, which answers from MAIN.
//   • name on the SERVER. There is no server row for a local session and this phase
//     deliberately adds no write (plan §5: `agent_presence` is untouched).
//   • ship a build step for one 60-element array.
//
// So it is duplicated ON PURPOSE and PINNED: the root suite's
// `src/features/channels/server/agent-names-desktop-parity.test.ts` imports both this
// file and the TS module and asserts the pools are identical IN ORDER and that the two
// pickers agree over a corpus of taken-sets. (Its sibling `agent-names.test.ts` pins the
// contract itself — charset, no repeats, suffixing past the end of the pool — against the
// canonical copy only.) A drift fails there, loudly, in the tree that owns the canonical
// copy. Change one, change both.
//
// THIS COPY IS THE ONE WITH A CALLER: `session-summary.js` names session pills from it
// (rollback §3.3). The TS module has no production caller and survives as the spec.
//
// The pool's own constraints (charset, single word, three families, purity) are
// documented at the canonical source and are unchanged here.

/** 60 handles: 20 minerals, 20 stars, 18 plants + `ember` and `wren`. */
const AGENT_NAME_POOL = Object.freeze([
  // Minerals & stone.
  'quartz',
  'onyx',
  'basalt',
  'flint',
  'cobalt',
  'granite',
  'obsidian',
  'jasper',
  'agate',
  'pyrite',
  'gypsum',
  'mica',
  'slate',
  'marble',
  'opal',
  'topaz',
  'garnet',
  'beryl',
  'calcite',
  'malachite',
  // Stars.
  'vega',
  'lyra',
  'rigel',
  'altair',
  'sirius',
  'deneb',
  'antares',
  'polaris',
  'capella',
  'procyon',
  'arcturus',
  'spica',
  'mizar',
  'alcor',
  'castor',
  'pollux',
  'bellatrix',
  'aldebaran',
  'canopus',
  'mira',
  // Plants & growing things (`ember` and `wren` close it out — neither is a
  // plant; both are in the pool because the product spec names them).
  'juniper',
  'cedar',
  'alder',
  'birch',
  'hazel',
  'willow',
  'laurel',
  'sorrel',
  'clover',
  'fennel',
  'thistle',
  'bramble',
  'heather',
  'aspen',
  'linden',
  'myrtle',
  'rowan',
  'sage',
  'ember',
  'wren',
]);

/**
 * The first pool handle not already taken, then the first free `<base>-<n>`.
 * Case-folded comparison and the round-sweeping suffix rule are the canonical
 * module's; see it for why each is what it is. Pure and deterministic: the same
 * `taken` always yields the same name.
 */
function pickAgentName(taken) {
  const used = new Set();
  if (taken) {
    for (const name of taken) used.add(String(name).toLowerCase());
  }

  for (const name of AGENT_NAME_POOL) {
    if (!used.has(name)) return name;
  }

  // Terminates by construction: every round offers AGENT_NAME_POOL.length
  // candidates no earlier round produced, and `used` is finite.
  for (let round = 2; ; round += 1) {
    for (const name of AGENT_NAME_POOL) {
      const candidate = `${name}-${round}`;
      if (!used.has(candidate)) return candidate;
    }
  }
}

module.exports = { AGENT_NAME_POOL, pickAgentName };
