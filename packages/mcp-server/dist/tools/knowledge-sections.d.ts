/**
 * **HOW A HEADING IS RENDERED AS AN ADDRESS** — the outline, the miss, the
 * one-line write footer and the nudge (Samuel's ruling 2026-09-03).
 *
 * ⚠ **NO PARSER LIVES HERE.** The split runs server-side
 * (`src/features/knowledge/server/service-sections.ts`) and arrives as data;
 * this module only decides how few characters it can be said in. That is
 * deliberate: `packages/mcp-server` cannot import the app's `src/` (tsconfig
 * `rootDir`), and a hand-copied markdown parser would be a second opinion about
 * what a heading is.
 *
 * ⚠ **EVERY LINE HERE IS BUDGETED, BECAUSE THIS IS THE SAVING.** An outline
 * that costs a third of the document it describes has bought nothing, so a row
 * is a heading and a number and nothing else, headings are elided at
 * {@link HEADING_MAX}, and the whole render is capped
 * ({@link OUTLINE_MAX_ROWS}).
 */
/** One heading, as the API sends it. ⚠ Structurally mirrored from
 *  `@dopl/client › KnowledgeOutlineRow`; declared here so the renderers can be
 *  driven by a literal in a test. */
export interface OutlineRow {
    heading: string;
    level: number;
    chars: number;
    start: number;
    line: number;
}
export interface Outline {
    sections: OutlineRow[];
    totalChars: number;
}
/**
 * The outline as its own result: one indented row per heading, each naming what
 * reading it costs.
 *
 * ⚠ **THE NESTING NOTE IS NOT CHROME.** A `##` row's count INCLUDES its `###`
 * children, so the rows do not sum to the total, and a reader that assumed they
 * did would conclude the entry was three times its size.
 */
export declare function renderOutline(outline: Outline): string[];
/** The header every outline render opens with. */
export declare function outlineHeading(title: string, outline: Outline): string;
/**
 * The one-line outline every WRITE result ends with.
 *
 * ⚠ **ONE LINE, NOT A BLOCK, AND NO COUNTS.** A write result is read once, by
 * the agent that just wrote; what it needs is the ADDRESSES it can now use, and
 * the sizes it already knows because it supplied the body.
 */
export declare function outlineFooter(outline: Outline | undefined): string | null;
/**
 * `reason=UNSECTIONED` — a long entry a section read cannot address.
 *
 * ⚠ **IT LEADS THE RESULT AND THE WRITE STILL LANDED** (Samuel's ruling). A
 * refusal here would refuse the user's content over our formatting taste, and
 * the agent that cannot guess the taste is the one being refused. `retry=none`
 * is stated because the natural reading of a `reason=` line is "do it again".
 */
export declare function unsectionedNudge(): string;
/**
 * `reason=SECTION_NOT_FOUND`, WITH the outline, so the retry needs no second
 * call. ⚠ That is the whole design: a refusal that costs a round trip to act on
 * has spent more than the read it refused.
 */
export declare function sectionMiss(heading: string, outline: Outline | undefined, title: string): string[];
/** `reason=SECTION_AMBIGUOUS` — two headings with one name, both named. */
export declare function sectionAmbiguous(heading: string, matches: OutlineRow[]): string[];
/**
 * ⚠ **HAND-COPIED FROM `src/shared/knowledge/caps.ts` — `packages/mcp-server`
 * cannot import the app's `src/`** (tsconfig `rootDir`). Drift is caught by
 * `src/shared/knowledge/caps.test.ts`, which reads BOTH sources and fails from
 * either side — the join `channel-poll-detector.ts` already rides. Do not "fix"
 * the duplication by deleting one; there is no import that can replace it, and
 * an un-pinned copy is the actual bug. **Every REASON lives in the app's file.**
 */
export declare const KB_SECTION_NUDGE_CHARS = 1500;
/** @see KB_SECTION_NUDGE_CHARS — hand-copied from the same file, same test. */
export declare const KB_PIN_WARN_CHARS = 4000;
/** @see KB_SECTION_NUDGE_CHARS — hand-copied from the same file, same test. */
export declare const KB_PIN_MAX_CHARS = 12000;
