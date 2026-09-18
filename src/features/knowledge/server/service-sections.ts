import "server-only";
import type { KnowledgeEntry } from "../types";
import {
  findSection,
  outlineOf,
  type MarkdownSection,
} from "@/shared/knowledge/markdown-sections";

/**
 * The section projection — where a heading becomes an address on the wire.
 *
 * It runs on the server, unlike `response-size.ts`'s knobs, because a `section`
 * is not a projection: it selects which part of a document to fetch, the way
 * `path` selects which document, so the body that never matched never crosses
 * the wire. Practically, `packages/mcp-server` cannot import `src/`, so a
 * renderer-side split would mean a hand-copied parser.
 *
 * Pure over an entry already read — everything here is arithmetic on
 * `entry.body`, so a sectioned read costs the database what a whole read does.
 */

/** One outline row as it travels: no `end`, which is derivable from the next. */
export interface KnowledgeOutlineRow {
  heading: string;
  level: number;
  /** Cost of reading this section — a parent's count contains its children's. */
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
 * An unknown section is a 200 carrying the outline, not a 404: the entry
 * resolved, only the heading did not, and returning the headings that do exist
 * saves the retry a second call. A 404 would assert "no such entry" falsely.
 *
 * The body is emptied on a miss and on an outline-only read — sending the whole
 * document beside a refusal would spend the characters this exists to save.
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
