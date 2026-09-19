/**
 * 🔒 **THE KB AUTHORING PREDICATES — THE HAND-COPY.**
 *
 * ⚠ **EVERY REASON LIVES IN `src/shared/knowledge/write-rules.ts`**, which is
 * also where the ruling behind these two questions is quoted. This file exists
 * because `packages/mcp-server` cannot import the app's `src/` (tsconfig
 * `rootDir`), which is the same boundary `knowledge-sections.ts` hand-copies the
 * caps across, for the same reason and with the same kind of join:
 * `src/shared/knowledge/write-rules.test.ts` reads BOTH files as TEXT and
 * requires the region below to be IDENTICAL, so drift fails from either side.
 *
 * ⚠ **DO NOT "FIX" THE DUPLICATION BY DELETING ONE.** There is no import that
 * can replace it, and an un-pinned copy is the actual bug.
 *
 * ⚠ **THE PREDICATE IS SHARED; THE WORDING IS NOT.** An agent gets a `reason=`
 * refusal naming what to add (`knowledge-write-rules.ts`), a person gets a
 * label. ⚠ **THE MERGE NOTE THAT SAT HERE IS DISCHARGED (2026-09-19).** The
 * refusal wrappers landed on a sibling branch of this wave deriving these two
 * questions THEMSELVES; `excerptRefusal` and `unsectionedRefusal` now call
 * {@link kbSummaryFault} and {@link kbBodyIsUnsectioned} and keep only their
 * sentences, so this pin guards the one predicate all three surfaces ask.
 */
/**
 * Fold to comparable words: lowercase, punctuation to spaces, runs collapsed.
 * ⚠ Used for the title comparison too — "Fuel." and "fuel" are the same
 * summary, and the whole point is that neither of them is one.
 */
export declare function foldWords(raw: string): string;
/** Which of the three failing summary shapes this entry has, or `null`. */
export type KbSummaryFault = "missing" | "one_word" | "restates_title";
/**
 * **THE SUMMARY RULE.** Absent, empty, one word, or the title again.
 *
 * ⚠ **THE THREE SHAPES ARE THE RULING'S, AND THERE IS DELIBERATELY NO LENGTH
 * FLOOR.** A short excerpt that states the answer outright ("$3.18/gal base
 * peg") is the best excerpt the wave-4 trial measured, and a minimum length
 * would refuse it. Empty, one word, and "the title again" are the shapes with
 * no legitimate case.
 */
export declare function kbSummaryFault(excerpt: string | null | undefined, title: string): KbSummaryFault | null;
/**
 * ⚠ **A PERMISSIVE HEADING DETECTOR, AND THE PERMISSIVENESS IS THE SAFETY
 * PROPERTY.** The real parser (`./markdown-sections.ts`, which knows a `#`
 * inside a fenced code block is not a heading) cannot be reached from the MCP
 * package, and a predicate that disagreed with its copy would be worse than one
 * that is generous. This regex therefore reads a code-fence `#` AS a heading —
 * a false NEGATIVE, which lets a write through and shows no warning. The
 * opposite error refuses (or nags about) a body that really is sectioned.
 */
export declare const KB_ANY_HEADING_RE: RegExp;
/**
 * **THE HEADINGS RULE.** A long body with no heading at all.
 *
 * ⚠ **ONLY ON A WHOLE-BODY WRITE, AND THAT IS NOT A LOOPHOLE.** With a
 * `section`, the text in hand is ONE section's new content and the entry's real
 * body is the server's merge of it, so a length test would be measuring the
 * wrong document. A caller naming a section has by construction addressed a
 * heading.
 */
export declare function kbBodyIsUnsectioned(body: string, section?: string): boolean;
