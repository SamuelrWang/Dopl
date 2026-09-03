/**
 * **THE REMOVED-VOCABULARY TABLE** — named-agent surfaces that no longer exist,
 * and the one statement of what a shipped string may not say.
 *
 * ⚠ **SPLIT OUT ON 2026-09-01, AND THE FILENAME IS LOAD-BEARING.**
 * `channel-law.test.ts` reached the 500-line cap when the `rename_agent` revival
 * needed its ruling written down; the table and the source-wide scan moved out
 * together (`law-scan.test.ts`). **This file is deliberately NOT named
 * `channel-*.ts`**, because the scan globs `channel-*.ts` and this module
 * literally CONTAINS the banned words as regexes — a prefixed filename would make
 * the guard fail on its own rule book. It carries no handler, so the parity
 * split-scan (which requires `channel-` on files that DO) does not want it either.
 *
 * ⚠ IT IS A PLAIN MODULE AND NOT A `.test.ts` ON PURPOSE: importing one test file
 * from another registers its `describe` blocks twice.
 *
 * ⚠ A description mentioning one of these does not merely mislead — it names ops
 * an MCP client rejects as invalid enum values, so the pin is total: the words
 * must not appear. Two consumers, and they ask different questions:
 *   `channel-law.test.ts` — is the DESCRIPTION free of them?
 *   `law-scan.test.ts`    — is every SHIPPED STRING in the directory?
 */
export declare const REMOVED_VOCABULARY: ReadonlyArray<[string, RegExp]>;
/**
 * 🔒 **THE ONE EXEMPTION, AND IT IS AN EXACT-STRING WHITELIST OF ONE.**
 *
 * `channel-hold-budget.ts › DESKTOP_HOLD_REFUSAL` is the desktop's own refusal
 * sentence, quoted VERBATIM (`dopl-desktop-app/main/session-permissions.js ›
 * AWAIT_DENY_MESSAGE`). Two refusals for one bound, worded differently, read to
 * an agent as two different problems — so the server-side fence T85 asked for
 * says exactly what the desktop's permission gate says, and the two literals are
 * pinned against each other from the desktop side.
 *
 * ⚠ **THE COLLISION IS REAL AND IT IS NOT RESOLVED IN THIS FILE'S FAVOUR.** The
 * sentence opens with the word `await`, which the row above bans because B8
 * retired that op — the desktop's wording predates the retirement by a day
 * (T85 is 2026-09-01, B8 landed 2026-09-02). Owed to Samuel: re-word BOTH
 * halves to say "the hold", or ratify the quote. Until then the exemption is
 * declared here rather than worked around by moving the constant out of the
 * scanned glob, because relocating a string to escape a gate is how a rule
 * becomes decorative.
 *
 * ⚠ **EXACT EQUALITY, NEVER `includes`.** A substring rule would exempt every
 * sentence that happens to contain this one, which is the whole failure mode a
 * whitelist has. One string, matched whole, or the ban applies.
 */
export declare const VERBATIM_QUOTES: ReadonlySet<string>;
/**
 * **THE TWENTY-TWO OP NAMES THE COLLAPSE RETIRED** (B8, 2026-09-02), and they
 * stopped PARSING at slice B16 one release later.
 *
 * ⚠ **A DIFFERENT QUESTION FROM {@link REMOVED_VOCABULARY}, WHICH IS WHY IT IS A
 * SECOND EXPORT RATHER THAN MORE ROWS.** That table bans WORDS anywhere in a
 * shipped string; these are ordinary words elsewhere — `list`, `update`, `open`,
 * `members` and `help` are live ops on other tools — so the scan that reads this
 * one matches a `dopl_channel` op POSITION, never the bare word
 * (`law-scan.test.ts`).
 *
 * ⚠ **IT LIVES HERE BECAUSE THIS FILE IS THE ONE THE SCAN SKIPS.** The rule book
 * literally contains the strings it forbids; a copy in any `channel-*.ts` would
 * fail the guard on the file that defines it.
 *
 * ⚠ **THE ONE-LINE REDIRECTS ARE GONE WITH `channel-retired-ops.ts`** — these
 * names now fail schema validation with the refusal `channel-schema.ts ›
 * unknownOpRefusal` writes. `read` is deliberately ABSENT: it is the one old
 * name that survived the collapse with its own meaning.
 */
export declare const RETIRED_CHANNEL_OPS: readonly string[];
