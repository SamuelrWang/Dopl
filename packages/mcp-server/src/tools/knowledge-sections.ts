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

import { inlineOr } from "./narration";

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
 * ⚠ **THE HEADING ELISION, AND IT IS THE POINT OF THE WHOLE RENDER.** A row is
 * an ADDRESS; the caller passes it back as `section=` and the match is
 * case-insensitive on the whole string, so an elided heading is one the caller
 * cannot use. Hence the ellipsis is a WARNING rather than a convenience, and 60
 * is set well above any heading a person writes.
 */
const HEADING_MAX = 60;

/** ⚠ An outline longer than this is an entry that should be several entries.
 *  The render says how many it stopped at rather than paging — a second call to
 *  finish an outline costs more than reading the document it describes. */
const OUTLINE_MAX_ROWS = 60;

/** The one-line form: `## A · ## B · ## C`, for a WRITE result. */
const ONE_LINE_MAX = 200;

function marks(level: number): string {
  return "#".repeat(Math.min(Math.max(1, level), 3));
}

function name(row: OutlineRow): string {
  const raw = row.heading.length > HEADING_MAX
    ? `${row.heading.slice(0, HEADING_MAX - 1)}…`
    : row.heading;
  return inlineOr(raw, "(unnamed)");
}

/** `1,234` — a character count a person can read at a glance. */
function n(value: number): string {
  return value.toLocaleString("en-US");
}

/**
 * The outline as its own result: one indented row per heading, each naming what
 * reading it costs.
 *
 * ⚠ **THE NESTING NOTE IS NOT CHROME.** A `##` row's count INCLUDES its `###`
 * children, so the rows do not sum to the total, and a reader that assumed they
 * did would conclude the entry was three times its size.
 */
export function renderOutline(outline: Outline): string[] {
  const rows = outline.sections.slice(0, OUTLINE_MAX_ROWS);
  const lines = rows.map(
    (r) => `${"  ".repeat(Math.max(0, Math.min(2, r.level - 1)))}${marks(r.level)} ${name(r)} · ${n(r.chars)}`,
  );
  if (outline.sections.length > rows.length) {
    lines.push(`_…and ${outline.sections.length - rows.length} more headings._`);
  }
  lines.push(
    `_${n(outline.totalChars)} chars whole; a count INCLUDES the sections nested under it. Read one: section="<heading>"._`,
  );
  return lines;
}

/** The header every outline render opens with. */
export function outlineHeading(title: string, outline: Outline): string {
  return `## ${inlineOr(title, "`(unnamed)`")} — ${outline.sections.length} heading${outline.sections.length === 1 ? "" : "s"} · ${n(outline.totalChars)} chars`;
}

/**
 * The one-line outline every WRITE result ends with.
 *
 * ⚠ **ONE LINE, NOT A BLOCK, AND NO COUNTS.** A write result is read once, by
 * the agent that just wrote; what it needs is the ADDRESSES it can now use, and
 * the sizes it already knows because it supplied the body.
 */
export function outlineFooter(outline: Outline | undefined): string | null {
  if (!outline || outline.sections.length === 0) return null;
  const parts = outline.sections.map((r) => `${marks(r.level)} ${name(r)}`);
  let line = parts.join(" · ");
  if (line.length > ONE_LINE_MAX) {
    let kept = 0;
    let used = 0;
    for (const p of parts) {
      if (used + p.length + 3 > ONE_LINE_MAX - 12) break;
      used += p.length + 3;
      kept += 1;
    }
    line = `${parts.slice(0, Math.max(1, kept)).join(" · ")} · +${parts.length - Math.max(1, kept)} more`;
  }
  return `_Sections: ${line}_`;
}

/**
 * `reason=UNSECTIONED` — a long entry a section read cannot address.
 *
 * ⚠ **IT LEADS THE RESULT AND THE WRITE STILL LANDED** (Samuel's ruling). A
 * refusal here would refuse the user's content over our formatting taste, and
 * the agent that cannot guess the taste is the one being refused. `retry=none`
 * is stated because the natural reading of a `reason=` line is "do it again".
 */
export function unsectionedNudge(): string {
  return `reason=UNSECTIONED · add ## headings so section reads work · retry=none`;
}

/**
 * `reason=SECTION_NOT_FOUND`, WITH the outline, so the retry needs no second
 * call. ⚠ That is the whole design: a refusal that costs a round trip to act on
 * has spent more than the read it refused.
 */
export function sectionMiss(
  heading: string,
  outline: Outline | undefined,
  title: string,
): string[] {
  const lines = [
    `reason=SECTION_NOT_FOUND · no heading ${inlineOr(heading, "`(unreadable)`")} in this entry · retry=one of the headings below`,
  ];
  if (!outline || outline.sections.length === 0) {
    lines.push(
      "",
      `This entry has NO headings at all, so it has no sections to address — read it whole (drop \`section\`), or add \`##\` headings with write_file.`,
    );
    return lines;
  }
  lines.push("", outlineHeading(title, outline), ...renderOutline(outline));
  return lines;
}

/** `reason=SECTION_AMBIGUOUS` — two headings with one name, both named. */
export function sectionAmbiguous(heading: string, matches: OutlineRow[]): string[] {
  return [
    `reason=SECTION_AMBIGUOUS · ${inlineOr(heading, "`(unreadable)`")} names ${matches.length} headings in this entry · retry=none, they have the same name`,
    "",
    ...matches.map((m) => `- line ${m.line} (offset ${m.start}) · ${marks(m.level)} ${name(m)} · ${n(m.chars)} chars`),
    "",
    `Read the whole entry, or read from a position with offset=. Renaming one of them is the durable fix.`,
  ];
}

/**
 * ⚠ **HAND-COPIED FROM `src/shared/knowledge/caps.ts` — `packages/mcp-server`
 * cannot import the app's `src/`** (tsconfig `rootDir`). Drift is caught by
 * `src/shared/knowledge/caps.test.ts`, which reads BOTH sources and fails from
 * either side — the join `channel-poll-detector.ts` already rides. Do not "fix"
 * the duplication by deleting one; there is no import that can replace it, and
 * an un-pinned copy is the actual bug. **Every REASON lives in the app's file.**
 */
export const KB_SECTION_NUDGE_CHARS = 1_500;

/** @see KB_SECTION_NUDGE_CHARS — hand-copied from the same file, same test. */
export const KB_PIN_WARN_CHARS = 4_000;

/** @see KB_SECTION_NUDGE_CHARS — hand-copied from the same file, same test. */
export const KB_PIN_MAX_CHARS = 12_000;
