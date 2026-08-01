/**
 * The curated handle pool a summoned agent is auto-named from, plus the picker.
 *
 * Design constraints, all load-bearing:
 * - Every entry matches the addressing charset `^[a-z][a-z0-9-]{1,30}$`, which
 *   the `channel_agents.name` CHECK enforces — a name this module returns must
 *   never be rejected by the DB.
 * - Single word, pronounceable, unambiguous when typed as an @-mention. Three
 *   families (minerals, stars, plants) so a room of agents reads as a set of
 *   NAMES rather than a numbered list.
 * - Pure and deterministic: no clock, no randomness, no I/O. The caller passes
 *   the handles already taken in that channel and gets the first free one, so
 *   the same room state always yields the same next name.
 *
 * This module is pure data + one function; it has no server-only import and is
 * safe to reuse anywhere the pool needs to be rendered.
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
 * `taken` is compared case-folded, matching the `(channel_id, lower(name))`
 * unique index — the DB is the real arbiter, and this must not hand back a
 * handle that only differs by case. The result is a CANDIDATE, not a
 * reservation: the caller still races other summons, and the unique index is
 * what actually decides. A service that loses that race re-picks with the
 * loser's handle added to `taken`.
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
