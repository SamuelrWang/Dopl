/**
 * THE LEGAL DOCS' MARKDOWN, PARSED — a deliberately tiny reader for the exact subset
 * `docs/legal/SERVICES-AGREEMENT.md` and `docs/legal/PRIVACY.md` use. The .md files are
 * the single source of truth for `/services-agreement` and `/privacy`; nothing copies
 * their text into JSX.
 *
 * Supported: `#`/`##`/`###` headings, paragraphs (soft-wrapped lines join), `---` rules,
 * pipe tables, `>` blockquotes (one rendered line per source line — the address blocks),
 * and inline `**bold**` / `` `code` `` (see `legal-markdown.tsx`). HTML comments — the
 * DRAFTING NOTE at the top of each file — are stripped and never rendered.
 *
 * ⚠ ANYTHING ELSE THROWS, ON PURPOSE. A bullet list, a numbered list, a code fence, raw
 * HTML or a link added to the docs would otherwise render as a literal paragraph of
 * markup on a legal page, with every gate green. The throw fails the static build and
 * `src/app/legal-pages.test.tsx`; extend this reader (and its test) when a doc needs more.
 */

export type LegalBlock =
  | { type: "heading"; level: 2 | 3; text: string; id: string }
  | { type: "paragraph"; text: string }
  | { type: "rule" }
  | { type: "table"; head: string[]; rows: string[][] }
  | { type: "quote"; lines: string[] };

export interface LegalDoc {
  /** The single `#` heading. */
  title: string;
  /** The text after "Last updated:", or null when the doc has no such line. */
  updated: string | null;
  blocks: LegalBlock[];
  /** Every `##` heading, in order — the table of contents. */
  sections: { text: string; id: string }[];
}

/** GitHub-style heading slug: "21. Dispute Resolution" → "21-dispute-resolution". */
export function slugifyHeading(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

const UNSUPPORTED = /^\s*(?:[-*+]\s|\d+\.\s|```|<|\[[^\]]*\]\()/;
const LINK = /\[[^\]]+\]\([^)]+\)/;

function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function fail(line: number, why: string, text: string): never {
  throw new Error(`legal markdown, line ${line}: ${why}: ${JSON.stringify(text.slice(0, 80))}`);
}

export function parseLegalMarkdown(source: string): LegalDoc {
  // Blank out comments line-for-line so error line numbers still match the file.
  const stripped = source.replace(/<!--[\s\S]*?-->/g, (c) => c.replace(/[^\n]/g, ""));
  const lines = stripped.split(/\r?\n/);
  const blocks: LegalBlock[] = [];
  const usedIds = new Map<string, number>();
  let title: string | null = null;
  let updated: string | null = null;

  const uniqueId = (text: string): string => {
    const base = slugifyHeading(text);
    const seen = usedIds.get(base) ?? 0;
    usedIds.set(base, seen + 1);
    return seen === 0 ? base : `${base}-${seen}`;
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    const n = i + 1;
    if (line.trim() === "") {
      i++;
      continue;
    }
    const heading = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (heading) {
      const level = heading[1]!.length;
      const text = heading[2]!;
      if (level === 1) {
        if (title !== null) fail(n, "a second `#` title", line);
        title = text;
      } else if (level === 2 || level === 3) {
        blocks.push({ type: "heading", level, text, id: uniqueId(text) });
      } else {
        fail(n, "heading deeper than ###", line);
      }
      i++;
      continue;
    }
    if (/^\s*---+\s*$/.test(line)) {
      blocks.push({ type: "rule" });
      i++;
      continue;
    }
    if (line.trimStart().startsWith("|")) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i]!.trimStart().startsWith("|")) {
        rows.push(splitRow(lines[i]!));
        i++;
      }
      const [head, divider, ...body] = rows;
      if (!head || !divider || !divider.every((c) => /^:?-+:?$/.test(c))) {
        fail(n, "a table needs a header row and a --- divider row", line);
      }
      blocks.push({ type: "table", head, rows: body });
      continue;
    }
    if (line.trimStart().startsWith(">")) {
      const quoted: string[] = [];
      while (i < lines.length && lines[i]!.trimStart().startsWith(">")) {
        quoted.push(lines[i]!.trimStart().replace(/^>\s?/, ""));
        i++;
      }
      blocks.push({ type: "quote", lines: quoted });
      continue;
    }
    // Paragraph: consecutive plain lines, soft-wrapped into one.
    const parts: string[] = [];
    while (i < lines.length) {
      const l = lines[i]!;
      if (l.trim() === "" || /^#{1,6}\s/.test(l) || /^\s*---+\s*$/.test(l)) break;
      if (l.trimStart().startsWith("|") || l.trimStart().startsWith(">")) break;
      if (UNSUPPORTED.test(l) || LINK.test(l)) fail(i + 1, "unsupported markdown", l);
      parts.push(l.trim());
      i++;
    }
    const text = parts.join(" ");
    const lastUpdated = /^Last updated:\s*(.+)$/.exec(text);
    if (lastUpdated && updated === null && blocks.length === 0) {
      updated = lastUpdated[1]!;
    } else {
      blocks.push({ type: "paragraph", text });
    }
  }

  if (title === null) throw new Error("legal markdown: no `#` title");
  const sections = blocks.flatMap((b) =>
    b.type === "heading" && b.level === 2 ? [{ text: b.text, id: b.id }] : [],
  );
  return { title, updated, blocks, sections };
}
