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
