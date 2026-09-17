/**
 * **A NAME A PERSON READS, NOT A HANDLE A MACHINE TYPED** (Samuel, 2026-09-17: orchestrators
 * were filing `picker-fix` and the operator saw `picker-fix`).
 *
 * ⚠ **THE DESCRIBE WAS THE CAUSE AND THE DESCRIBE IS FIXED** (`channel-schema.ts`'s `name`
 * field, which told every client the name was *"slugged (`@bug-reviewer`)"* and so read as an
 * instruction to PASS a slug). This module is the second half: prose reaches a model as a
 * suggestion, and the surface that stores the name has to be right when the suggestion is
 * ignored.
 *
 * ⚠ **IT NORMALIZES AND NEVER REFUSES.** A refusal costs the caller a round trip and buys
 * nothing here — every slug has exactly one readable spelling, so there is nothing to ask
 * about. The refusals on this lane stay where they are (`channel-ops-launch-name.ts`: empty,
 * and id-shaped), and both are decided BEFORE this runs — uppercasing an id would walk it past
 * its own check.
 *
 * ⚠ **THE TAG DERIVATION IS UNTOUCHED.** `channel-ops-launch-name.ts › launchedTag` still
 * lowercases and hyphenates whatever was stored, so `picker-fix` and `Picker Fix` publish the
 * SAME `@picker-fix`: this changes what a human reads, never what an agent addresses.
 */

/**
 * A string is SLUG-LIKE when it carries no information about how it should be capitalized:
 * lowercase letters, digits and the two separators, and nothing else.
 *
 * ⚠ **THE ABSENCE OF A SPACE IS THE WHOLE TEST.** A name with a space ("Picker Fix", "bug
 * reviewer") is a name somebody wrote as a name; casing it would be this module editing a
 * choice rather than repairing a missing one.
 */
const SLUG_LIKE = /^[a-z0-9_-]+$/;

/**
 * The display name to STORE for `raw` — Title Case words when `raw` is slug-like, and `raw`
 * itself (trimmed) otherwise.
 *
 * ⚠ **`""` SURVIVES AS `""`**, which is the rename lane's deliberate CLEAR gesture
 * (`channel-dispatch-agents.ts` documents why it is not "missing"). Nothing else on this path
 * may invent a name for it.
 * ⚠ **IT CANNOT LENGTHEN A STRING**, so the 1-60 bound the desktop enforces (`bad-name`) means
 * the same thing on both sides of this call: each separator run collapses to ONE space and
 * `toUpperCase` on an ASCII letter is one character for one.
 */
export function agentDisplayName(raw: string | undefined): string {
  const name = String(raw ?? "").trim();
  if (!SLUG_LIKE.test(name)) return name;
  const titled = name
    .split(/[-_]+/)
    .filter((word) => word.length > 0)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
  // ⚠ **SEPARATORS ALONE ("--") ARE NOT A CLEAR.** Every word filtered away would answer `""`,
  // which is the rename lane's CLEAR gesture — a normalizer must never invent one.
  return titled === "" ? name : titled;
}
