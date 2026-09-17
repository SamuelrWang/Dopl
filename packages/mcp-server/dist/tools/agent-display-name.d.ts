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
export declare function agentDisplayName(raw: string | undefined): string;
