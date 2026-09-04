/**
 * **A MARKDOWN HEADING IS AN ADDRESS** — the pure split behind
 * `dopl_kb(op="outline")` and `read_file(section=…)` (Samuel's ruling
 * 2026-09-03).
 *
 * ⚠ **WHY THIS EXISTS.** An agent that wants one paragraph of a knowledge entry
 * pays for the whole entry, every time, because the only addressable unit was
 * the FILE. Notion's answer is a stored block tree; ours is the markdown the
 * user already wrote — `#`/`##`/`###` headings, split at READ time, so nothing
 * is migrated, nothing is re-modelled, and an entry written before this existed
 * is addressable the moment it grows a heading.
 *
 * ⚠ **PURE, AND WITH NO IMPORTS AT ALL.** It is called from the knowledge
 * service (`features/knowledge/server/service-sections.ts`) on the READ path and
 * from `service-paths.ts` on the WRITE path; keeping it dependency-free is what
 * lets both use it and what makes it testable as arithmetic over a string.
 *
 * ⚠ **OFFSETS ARE INTO THE ORIGINAL STRING, CRLF AND ALL.** Nothing here
 * normalises line endings, because an offset a caller cannot use against the
 * body it was handed is worse than no offset. Every `start`/`end` indexes the
 * body exactly as stored.
 *
 * ⚠ **WHAT IS DELIBERATELY NOT A HEADING.** A `#` inside a fenced code block —
 * a shell comment, a CSS id, a Python comment — is the single most common false
 * positive in a knowledge base full of snippets, and treating one as a section
 * boundary would hand an agent a "section" that is half a code sample. Level 4+
 * (`####`) is not a boundary either: three levels are enough to address a
 * document, and every deeper heading stays inside its `###` parent where a
 * reader expects to find it.
 */

/** The three addressable heading levels. `####` and deeper are body text. */
export type HeadingLevel = 1 | 2 | 3;

/** The largest heading level this module treats as an address. */
export const MAX_ADDRESSABLE_LEVEL = 3;

export interface MarkdownSection {
  /** Heading text with the `#` marks, trailing `#`s and whitespace removed. */
  heading: string;
  level: HeadingLevel;
  /** Offset of the first character of the heading line. */
  start: number;
  /**
   * Offset one past the last character of the section — the next heading of the
   * SAME OR HIGHER level, or the end of the body.
   *
   * ⚠ **A PARENT CONTAINS ITS CHILDREN.** A `##` section's span includes every
   * `###` under it, so the per-section counts do NOT sum to
   * {@link MarkdownOutline.totalChars}. That is the useful number: it answers
   * "what does reading this section cost me", which is the whole question.
   */
  end: number;
  /** `end - start`. */
  chars: number;
  /** 1-based line number of the heading line — for the ambiguity refusal. */
  line: number;
}

export interface MarkdownOutline {
  sections: MarkdownSection[];
  /** The entry's whole length, so a caller can state the saving. */
  totalChars: number;
}

/** ⚠ Every failure names a REASON a tool surface can print verbatim. */
export type SectionFailure =
  | { ok: false; reason: "SECTION_NOT_FOUND" }
  | { ok: false; reason: "SECTION_AMBIGUOUS"; matches: MarkdownSection[] };

export type SectionLookup = { ok: true; section: MarkdownSection } | SectionFailure;

// ── the scan ────────────────────────────────────────────────────────

interface Line {
  /** Offset of the line's first character. */
  start: number;
  /** Offset of the first character of the NEXT line (past the EOL). */
  next: number;
  /** The line without its `\n` or `\r\n`. */
  text: string;
}

/**
 * Split into lines, keeping each one's offset in the ORIGINAL body.
 *
 * ⚠ A body with no trailing newline yields a final line like any other, and a
 * body that ends WITH one yields a final empty line that is never a heading —
 * both are the shapes real entries arrive in.
 */
function scanLines(body: string): Line[] {
  const out: Line[] = [];
  let i = 0;
  for (;;) {
    const nl = body.indexOf("\n", i);
    if (nl === -1) {
      out.push({ start: i, next: body.length, text: body.slice(i) });
      return out;
    }
    const stop = nl > i && body.charCodeAt(nl - 1) === 13 ? nl - 1 : nl;
    out.push({ start: i, next: nl + 1, text: body.slice(i, stop) });
    i = nl + 1;
  }
}

/** ` ``` ` / `~~~` opener or closer, with its marker char and run length. */
const FENCE_RE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
/** `# `, `## `, `### ` — a space (or line end) is required, so `#tag` is text. */
const ATX_RE = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*$/;
/** A setext underline: a run of `=` (level 1) or `-` (level 2), nothing else. */
const SETEXT_RE = /^ {0,3}(=+|-+)[ \t]*$/;
/** Blank, for "a setext underline needs a paragraph line above it". */
const BLANK_RE = /^[ \t]*$/;

/** Strip a trailing closing run of `#`s (`## Setup ##` → `Setup`). */
function trimAtxText(raw: string): string {
  return raw.replace(/[ \t]+#+[ \t]*$/, "").trim();
}

interface Head {
  heading: string;
  level: HeadingLevel;
  start: number;
  /** Offset just past the heading itself (past its underline, for setext). */
  bodyStart: number;
  line: number;
}

/**
 * Every heading in `body`, in document order.
 *
 * ⚠ **FRONTMATTER IS SKIPPED WHOLE.** A `---` on the first line opens a YAML
 * block, and its closing `---` sits under a `key: value` line — which is
 * exactly the shape of a setext heading. Without this, every front-mattered
 * entry would report a phantom `## title: …` as its first section.
 */
function scanHeads(body: string): Head[] {
  const lines = scanLines(body);
  const heads: Head[] = [];
  let fence: { char: string; len: number } | null = null;
  let consumed = -1; // index of a line already spent as heading text
  let i = 0;
  if (lines.length > 0 && lines[0].text.trim() === "---") {
    let j = 1;
    while (j < lines.length && lines[j].text.trim() !== "---") j += 1;
    i = j < lines.length ? j + 1 : 1;
  }
  for (; i < lines.length; i += 1) {
    const line = lines[i];
    const fenceMatch = FENCE_RE.exec(line.text);
    if (fenceMatch) {
      const run = fenceMatch[1];
      if (fence === null) {
        fence = { char: run[0], len: run.length };
        continue;
      }
      // A closer is the same character, at least as long, with nothing after it.
      if (run[0] === fence.char && run.length >= fence.len && fenceMatch[2].trim() === "") {
        fence = null;
      }
      continue;
    }
    if (fence !== null) continue;

    const atx = ATX_RE.exec(line.text);
    if (atx) {
      const level = atx[1].length;
      if (level <= MAX_ADDRESSABLE_LEVEL) {
        heads.push({
          heading: trimAtxText(atx[2] ?? ""),
          level: level as HeadingLevel,
          start: line.start,
          bodyStart: line.next,
          line: i + 1,
        });
      }
      consumed = i;
      continue;
    }

    // Setext: an underline whose PREVIOUS line is an unspent paragraph line.
    const setext = SETEXT_RE.exec(line.text);
    if (setext && i > 0 && consumed !== i - 1) {
      const above = lines[i - 1];
      if (!BLANK_RE.test(above.text) && !FENCE_RE.test(above.text)) {
        heads.push({
          heading: above.text.trim(),
          level: setext[1][0] === "=" ? 1 : 2,
          start: above.start,
          bodyStart: line.next,
          line: i,
        });
        consumed = i;
      }
    }
  }
  return heads;
}

/**
 * The entry's outline: every `#`/`##`/`###` heading with its offset and the
 * character cost of reading it.
 */
export function outlineOf(body: string): MarkdownOutline {
  const heads = scanHeads(body);
  const sections: MarkdownSection[] = heads.map((h, idx) => {
    let end = body.length;
    for (let j = idx + 1; j < heads.length; j += 1) {
      if (heads[j].level <= h.level) {
        end = heads[j].start;
        break;
      }
    }
    return {
      heading: h.heading,
      level: h.level,
      start: h.start,
      end,
      chars: end - h.start,
      line: h.line,
    };
  });
  return { sections, totalChars: body.length };
}

/** How many addressable headings `body` carries. */
export function sectionCount(body: string): number {
  return scanHeads(body).length;
}

/**
 * Normalise a caller's heading argument. ⚠ Agents paste the heading as they saw
 * it — `## Setup` — and refusing that would be a refusal over punctuation.
 */
function normalizeQuery(heading: string): string {
  return trimAtxText(heading.replace(/^[ \t]*#{1,6}[ \t]*/, "")).trim();
}

/**
 * Resolve a heading to ONE section.
 *
 * ⚠ **EXACT FIRST, THEN CASE-INSENSITIVE**, and the fallback runs only when the
 * exact pass found nothing — so a document holding both `Setup` and `setup`
 * still addresses each of them precisely.
 *
 * ⚠ **TWO IDENTICAL HEADINGS REFUSE, NAMING BOTH.** Picking the first would
 * make `write_file(section=…)` overwrite a section the caller did not mean, and
 * that write is unrecoverable.
 */
export function findSection(body: string, heading: string): SectionLookup {
  const query = normalizeQuery(heading);
  const { sections } = outlineOf(body);
  let matches = sections.filter((s) => s.heading === query);
  if (matches.length === 0) {
    const lower = query.toLowerCase();
    matches = sections.filter((s) => s.heading.toLowerCase() === lower);
  }
  if (matches.length === 0) return { ok: false, reason: "SECTION_NOT_FOUND" };
  if (matches.length > 1) return { ok: false, reason: "SECTION_AMBIGUOUS", matches };
  return { ok: true, section: matches[0] };
}

/** The heading and everything under it, up to the next heading of the same or
 *  higher level. */
export function sliceSection(
  body: string,
  heading: string,
): { ok: true; section: MarkdownSection; text: string } | SectionFailure {
  const found = findSection(body, heading);
  if (!found.ok) return found;
  return {
    ok: true,
    section: found.section,
    text: body.slice(found.section.start, found.section.end),
  };
}

/** True when `text` opens with a heading naming this same section. */
function repeatsHeading(text: string, section: MarkdownSection): boolean {
  const heads = scanHeads(text);
  return (
    heads.length > 0 &&
    heads[0].start === text.length - text.trimStart().length &&
    heads[0].heading.toLowerCase() === section.heading.toLowerCase()
  );
}

/**
 * Replace ONE section's content, leaving the rest of the entry byte-identical.
 *
 * ⚠ **THE HEADING LINE SURVIVES BY DEFAULT.** A caller that sends only the new
 * prose keeps its heading; a caller that sends the heading back with the prose
 * is not given two of them. Both shapes are what an agent actually writes, and
 * refusing either would be a refusal over formatting.
 *
 * ⚠ **A SECTION FOLLOWED BY ANOTHER ONE ALWAYS ENDS IN A NEWLINE**, so a
 * replacement that forgets one cannot weld two headings onto one line. Nothing
 * is added when the section is the LAST thing in the entry — an entry with no
 * trailing newline keeps not having one.
 */
export function replaceSection(
  body: string,
  heading: string,
  newContent: string,
): { ok: true; body: string; section: MarkdownSection } | SectionFailure {
  const found = findSection(body, heading);
  if (!found.ok) return found;
  const { section } = found;
  const headingLine = body.slice(section.start, headingEnd(body, section));
  let replacement = repeatsHeading(newContent, section)
    ? newContent
    : headingLine + newContent;
  const hasFollowing = section.end < body.length;
  if (hasFollowing && !replacement.endsWith("\n")) replacement += "\n";
  return {
    ok: true,
    body: body.slice(0, section.start) + replacement + body.slice(section.end),
    section,
  };
}

/** Offset just past a section's heading line(s), including its EOL. */
function headingEnd(body: string, section: MarkdownSection): number {
  for (const h of scanHeads(body)) {
    if (h.start === section.start) return h.bodyStart;
  }
  return section.start;
}

/**
 * Append a NEW `##` section at the end of the entry.
 *
 * ⚠ **`##`, NOT the level of whatever precedes it.** A new topic in an entry
 * that has never been sectioned is a sibling of the sections the nudge asks for,
 * and guessing a depth from the last heading would nest an unrelated topic
 * under it. The write result SAYS the section was created and at what level.
 */
export function appendSection(body: string, heading: string, content: string): string {
  const name = normalizeQuery(heading);
  const head = body.length === 0 || body.endsWith("\n") ? "" : "\n";
  const gap = body.length === 0 ? "" : "\n";
  const tail = content.endsWith("\n") ? "" : "\n";
  return `${body}${head}${gap}## ${name}\n${content}${tail}`;
}
