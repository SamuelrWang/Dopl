/**
 * 🔒 **THE BODY'S SIZE AND ITS FINGERPRINT, WORDED ONCE** (S33 + S47,
 * 2026-09-18).
 *
 * ── S47: A COUNT BEFORE THE WRITE, NOT ONLY AFTER IT ────────────────────────
 *
 * `write_file`'s result has always printed `N chars`; `read_file`'s header
 * never did. So an agent deciding whether an entry is about to cross the
 * sectioning threshold, or whether a rewrite is a trim or a doubling, had no
 * number until after it had written — which is the one moment the number is
 * useless. `op="outline"` carries a count, but a caller that already has the
 * body should not need a second call to learn how long it is.
 *
 * ── S33: A DIGEST, SO A TIMEOUT IS ANSWERABLE ───────────────────────────────
 *
 * ⚠ **`expected_version` ANSWERS "DID SOMEBODY ELSE WRITE"; NOTHING ANSWERED
 * "DID MY WRITE LAND".** A write that times out on the wire leaves an agent
 * with no way to tell a landed write from a lost one but to re-read and compare
 * whole bodies, which costs the body twice. A digest printed on BOTH sides —
 * the write result and the read header — makes that one string comparison.
 *
 * ⚠ **IT IS A FINGERPRINT, NOT A VERSION, AND IT IS NOT AN ARGUMENT.** Nothing
 * accepts it back; `expected_version` is the only precondition on this surface
 * and a second one would be two answers to one question. 12 hex characters of
 * SHA-256 — enough that two bodies an agent is choosing between do not collide,
 * short enough to sit in a header.
 *
 * ⚠ **OVER THE BODY AS STORED**, never over a clipped or sectioned render: a
 * digest that changed with `max_chars` would compare a window against a whole
 * document and report a difference that is the READ's, not the entry's.
 */
/** 12 hex characters of SHA-256 over the stored body. */
export declare function bodyDigest(body: string): string;
/**
 * The clause both surfaces print. ⚠ ONE spelling, so a caller can compare the
 * two strings rather than two formats.
 */
export declare function bodyFact(body: string): string;
