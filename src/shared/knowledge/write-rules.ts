/**
 * 🔒 **THE KB AUTHORING PREDICATES — ONE DEFINITION, TWO AUDIENCES**
 * (Samuel's ruling 2026-09-18, option A on the fix list's Q1).
 *
 * > *"are you saying that saves should be blocked if there's no description? I
 * > think I agree with A as well."* … *"Human typing in the app: warn only,
 * > never blocked."*
 *
 * ⚠ **THE SAME TWO QUESTIONS, ANSWERED THE SAME WAY, ACTED ON DIFFERENTLY.** An
 * AGENT save is REFUSED when the summary is missing/one-word/title-restating, or
 * when a long body carries no `##` headings. A HUMAN typing in the app is
 * WARNED and never blocked. **What must not differ is which entries the two
 * consider faulty** — a person warned about a page an agent would have been
 * refused for, and vice versa, is two rules wearing one ruling.
 *
 * ⚠ **SO THE PREDICATES ARE HAND-COPIED AND PINNED BYTE-FOR-BYTE, WHICH IS THIS
 * TREE'S ANSWER TO THIS EXACT BOUNDARY** (`./caps.ts` and its test, same
 * argument, same join). `packages/mcp-server` cannot import `src/` (its tsconfig
 * `rootDir` is its own `src`), so the copy lives at
 * `packages/mcp-server/src/tools/knowledge-write-predicates.ts` and
 * `./write-rules.test.ts` reads BOTH files as TEXT and requires the region
 * between the two `PREDICATE REGION` markers to be identical. A source read
 * fails from EITHER side; an import could not exist at all.
 * ⚠ **EVERY REASON LIVES IN THIS FILE**, as it does for the caps — the copy
 * carries the code and a pointer back here.
 * ⚠ **THE WORDING IS NOT SHARED AND MUST NOT BE.** The agent gets a `reason=` /
 * `retry=` refusal naming what to add; the person gets a label. Only the
 * QUESTION is one implementation.
 */

import { KB_SECTION_NUDGE_CHARS } from "./caps";

// ⚠ EDIT BOTH COPIES IN ONE CHANGE. The other is `packages/mcp-server/src/tools/knowledge-write-predicates.ts`.
// ─── PREDICATE REGION — pinned byte-for-byte by ./write-rules.test.ts ───

/**
 * Fold to comparable words: lowercase, punctuation to spaces, runs collapsed.
 * ⚠ Used for the title comparison too — "Fuel." and "fuel" are the same
 * summary, and the whole point is that neither of them is one.
 */
export function foldWords(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

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
export function kbSummaryFault(
  excerpt: string | null | undefined,
  title: string,
): KbSummaryFault | null {
  const folded = excerpt ? foldWords(excerpt) : "";
  if (folded === "") return "missing";
  if (!folded.includes(" ")) return "one_word";
  if (folded === foldWords(title)) return "restates_title";
  return null;
}

/**
 * ⚠ **A PERMISSIVE HEADING DETECTOR, AND THE PERMISSIVENESS IS THE SAFETY
 * PROPERTY.** The real parser (`./markdown-sections.ts`, which knows a `#`
 * inside a fenced code block is not a heading) cannot be reached from the MCP
 * package, and a predicate that disagreed with its copy would be worse than one
 * that is generous. This regex therefore reads a code-fence `#` AS a heading —
 * a false NEGATIVE, which lets a write through and shows no warning. The
 * opposite error refuses (or nags about) a body that really is sectioned.
 */
export const KB_ANY_HEADING_RE = /^[ \t]{0,3}#{1,3}[ \t]+\S/m;

/**
 * **THE HEADINGS RULE.** A long body with no heading at all.
 *
 * ⚠ **ONLY ON A WHOLE-BODY WRITE, AND THAT IS NOT A LOOPHOLE.** With a
 * `section`, the text in hand is ONE section's new content and the entry's real
 * body is the server's merge of it, so a length test would be measuring the
 * wrong document. A caller naming a section has by construction addressed a
 * heading.
 */
export function kbBodyIsUnsectioned(body: string, section?: string): boolean {
  if (section !== undefined) return false;
  if (body.length <= KB_SECTION_NUDGE_CHARS) return false;
  return !KB_ANY_HEADING_RE.test(body);
}

// ─── END PREDICATE REGION ───
