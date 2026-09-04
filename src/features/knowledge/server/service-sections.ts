import "server-only";
import type { KnowledgeEntry } from "../types";
import {
  findSection,
  outlineOf,
  type MarkdownSection,
} from "@/shared/knowledge/markdown-sections";

/**
 * **THE SECTION PROJECTION — WHERE A HEADING BECOMES AN ADDRESS ON THE WIRE.**
 *
 * ⚠ **IT RUNS ON THE SERVER, NOT IN THE RENDERER, AND THAT IS THE ONE PLACE
 * THIS WAVE DEPARTS FROM `response-size.ts`'s RULE.** That module's three knobs
 * (`response_format`, `fields`, `max_chars`) are applied where the text is
 * assembled, because they PROJECT a payload the loopback already paid for. A
 * `section` is not a projection: it SELECTS which part of a document to fetch,
 * the way `path` selects which document — so it belongs beside `path`, on the
 * request, and the body that never matched never crosses the wire either.
 * ⚠ The practical half of the same argument: `packages/mcp-server` cannot import
 * `src/` (its tsconfig `rootDir` is its own `src`), so a renderer-side split
 * would mean a hand-copied parser. One implementation, one place.
 *
 * ⚠ **PURE OVER AN ENTRY ALREADY READ — NO SECOND QUERY, EVER.** Everything
 * here is arithmetic on `entry.body`, so a sectioned read costs exactly what a
 * whole read costs the DATABASE and a fraction of what it costs the model.
 */

/** One outline row as it travels: no `end`, which is derivable from the next. */
export interface KnowledgeOutlineRow {
  heading: string;
  level: number;
  /** Cost of reading this section — a parent's count CONTAINS its children's. */
  chars: number;
  /** Char offset of the heading, so `offset=` can resume from here. */
  start: number;
  /** 1-based line of the heading, which is how an ambiguity is reported. */
  line: number;
}

export interface KnowledgeOutlinePayload {
  sections: KnowledgeOutlineRow[];
  /** The whole entry's length, so a caller can state what it did not pay for. */
  totalChars: number;
}

export type KnowledgeSectionOutcome =
  | { ok: true; heading: string; level: number; start: number; end: number; chars: number }
  | { ok: false; reason: "SECTION_NOT_FOUND" }
  | { ok: false; reason: "SECTION_AMBIGUOUS"; matches: KnowledgeOutlineRow[] };

export interface KnowledgeFileProjection {
  entry: KnowledgeEntry;
  outline?: KnowledgeOutlinePayload;
  section?: KnowledgeSectionOutcome;
}

function row(s: MarkdownSection): KnowledgeOutlineRow {
  return { heading: s.heading, level: s.level, chars: s.chars, start: s.start, line: s.line };
}

/** The entry's outline, as it travels. */
export function outlinePayload(body: string): KnowledgeOutlinePayload {
  const { sections, totalChars } = outlineOf(body);
  return { sections: sections.map(row), totalChars };
}

/**
 * Project a read.
 *
 * ⚠ **AN UNKNOWN SECTION IS A 200 CARRYING THE OUTLINE, NOT A 404.** The entry
 * resolved; what did not resolve is a heading inside it, and the answer that
 * costs the caller nothing is the list of headings that DO exist — so the retry
 * needs no second call. A 404 here would mean "no such entry", which is a
 * different fact and one this response would be asserting falsely.
 *
 * ⚠ **THE BODY IS EMPTIED ON A MISS AND ON AN OUTLINE-ONLY READ.** Sending the
 * whole document beside a refusal to name part of it would spend exactly the
 * characters the argument exists to save.
 */
export function projectFile(
  entry: KnowledgeEntry,
  opts: { section?: string; outline?: boolean },
): KnowledgeFileProjection {
  const body = entry.body ?? "";
  if (opts.section === undefined) {
    if (!opts.outline) return { entry };
    return { entry: { ...entry, body: "" }, outline: outlinePayload(body) };
  }
  const outline = outlinePayload(body);
  const found = findSection(body, opts.section);
  if (!found.ok) {
    const section: KnowledgeSectionOutcome =
      found.reason === "SECTION_AMBIGUOUS"
        ? { ok: false, reason: "SECTION_AMBIGUOUS", matches: found.matches.map(row) }
        : { ok: false, reason: "SECTION_NOT_FOUND" };
    return { entry: { ...entry, body: "" }, outline, section };
  }
  const s = found.section;
  return {
    entry: { ...entry, body: body.slice(s.start, s.end) },
    outline,
    section: {
      ok: true,
      heading: s.heading,
      level: s.level,
      start: s.start,
      end: s.end,
      chars: s.chars,
    },
  };
}
