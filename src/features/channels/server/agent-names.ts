/**
 * The curated handle pool an agent is auto-named from, plus the picker.
 *
 * Design constraints, all load-bearing:
 * - Every entry matches the addressing charset `^[a-z][a-z0-9-]{1,30}$` — the shape a handle
 *   has to have to be typed as an @-mention and to satisfy the `channel_agents.name` CHECK.
 *   Nothing writes that table since the rollback, so the charset is a property of the NAME
 *   now rather than a DB round trip, and it is still the reason a handle is safe to render.
 * - Single word, pronounceable, unambiguous when typed as an @-mention. Three
 *   families (minerals, stars, plants) so a room of agents reads as a set of
 *   NAMES rather than a numbered list.
 * - Pure and deterministic: no clock, no randomness, no I/O. The caller passes
 *   the handles already taken in that channel and gets the first free one, so
 *   the same room state always yields the same next name.
 *
 * This module is pure data + one function; it has no server-only import and is
 * safe to reuse anywhere the pool needs to be rendered.
 *
 * IT IS THE CANONICAL SPEC OF A SHIPPED GENERATOR, NOT A RESERVATION FOR A FUTURE ONE.
 * Summoning is gone (channels rollback §1) and nothing in THIS tree calls `pickAgentName`.
 * §3.3 shipped and session pills are named in the desktop MAIN process, which is CommonJS
 * with no build step and cannot import this file — so it names them from
 * `dopl-desktop-app/main/agent-names.js`, a deliberate byte-for-byte PORT of this module.
 *
 * That port is what makes this file load-bearing rather than residue. The pool ORDER is
 * behaviour (`pickAgentName` returns the first free entry), and the only thing holding the
 * two copies together is `agent-names-desktop-parity.test.ts`, which compares the live
 * desktop copy against THIS one element-wise and runs both pickers over one corpus. Delete
 * this module and that guard has nothing to compare against, so the pool a user actually
 * sees becomes unpinned. `agent-names.test.ts` pins the contract the port must satisfy
 * (charset, no repeats, suffixing past the end of the pool).
 *
 * ⚠ DO NOT DELETE THIS AS UNUSED. Measured 2026-08-20 — re-run rather than trust
 * the sentence: `grep -rn 'agent-names' src apps packages`. In `src/` this module
 * has ZERO production importers; the only two are `agent-names.test.ts` and
 * `agent-names-desktop-parity.test.ts`. That is not residue, it is the module's
 * job now: **its role in `src/` is the PARITY REFERENCE for
 * `dopl-desktop-app/main/agent-names.js`**, which is the copy that actually names
 * the pills a user sees. An unused-export sweep that removes this leaves the
 * shipped generator with nothing pinning it.
 *
 * CHANGE ONE, CHANGE BOTH — and this is the one to change first.
 */

/** 60 handles: 20 minerals, 20 stars, 18 plants + `ember` and `wren`. */
export const AGENT_NAME_POOL: readonly string[] = [
  // Minerals & stone.
  "quartz",
  "onyx",
  "basalt",
  "flint",
  "cobalt",
  "granite",
  "obsidian",
  "jasper",
  "agate",
  "pyrite",
  "gypsum",
  "mica",
  "slate",
  "marble",
  "opal",
  "topaz",
  "garnet",
  "beryl",
  "calcite",
  "malachite",
  // Stars.
  "vega",
  "lyra",
  "rigel",
  "altair",
  "sirius",
  "deneb",
  "antares",
  "polaris",
  "capella",
  "procyon",
  "arcturus",
  "spica",
  "mizar",
  "alcor",
  "castor",
  "pollux",
  "bellatrix",
  "aldebaran",
  "canopus",
  "mira",
  // Plants & growing things (`ember` and `wren` close it out — neither is a
  // plant; both are in the pool because the product spec names them).
  "juniper",
  "cedar",
  "alder",
  "birch",
  "hazel",
  "willow",
  "laurel",
  "sorrel",
  "clover",
  "fennel",
  "thistle",
  "bramble",
  "heather",
  "aspen",
  "linden",
  "myrtle",
  "rowan",
  "sage",
  "ember",
  "wren",
];

/**
 * The first pool handle not already taken in the channel; once the pool is
 * exhausted, the first free `<base>-<n>` suffix (`quartz-2`, `onyx-2`, … then
 * `quartz-3`). Suffixing sweeps the WHOLE pool per round rather than exhausting
 * one base, so a busy channel still reads as varied names instead of
 * `quartz-2..quartz-9`.
 *
 * `taken` is compared case-folded: two handles that differ only by case read as the same name
 * to a person, and the rule predates the rollback, where the `(channel_id, lower(name))` unique
 * index was the real arbiter. There is no such index in the path today — the desktop port names
 * in-process from the handles it already holds — so the caller passing a complete `taken` set is
 * what makes the answer correct, and it stays a CANDIDATE rather than a reservation.
 */
export function pickAgentName(taken: Set<string>): string {
  const used = new Set<string>();
  for (const name of taken) used.add(name.toLowerCase());

  for (const name of AGENT_NAME_POOL) {
    if (!used.has(name)) return name;
  }

  // ONE mechanism, and it terminates by construction — no artificial bound and
  // therefore no unreachable "exhausted" branch to lie about. Every round
  // offers `AGENT_NAME_POOL.length` candidates that no earlier round produced
  // (the round number is part of the handle), while `used` is a finite set, so
  // some round offers a candidate that is not in it and the loop returns.
  for (let round = 2; ; round += 1) {
    for (const name of AGENT_NAME_POOL) {
      const candidate = `${name}-${round}`;
      if (!used.has(candidate)) return candidate;
    }
  }
}
