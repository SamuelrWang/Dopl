import TurndownService from "turndown";

/** Turndown rules for the KB doc editor's HTML→markdown round-trip. */

/**
 * Anchor rule → GFM inline `[text](href "title")`. ⚠ Bypasses turndown's
 * default rule: Tiptap-injected attrs (class, target, rel) can make the
 * default skip the anchor. Keyed only on `a[href]`, so it always round-trips.
 */
export function makeLinkRule(): TurndownService.Rule {
  return {
    filter: (node) =>
      node.nodeName === "A" && !!(node as HTMLAnchorElement).getAttribute("href"),
    replacement(content, node) {
      const a = node as HTMLAnchorElement;
      const href = a.getAttribute("href") ?? "";
      const title = a.getAttribute("title");
      // `content` = already-converted link text; empty (autolink) → use URL.
      const text = content.trim() || href;
      return title ? `[${text}](${href} "${title}")` : `[${text}](${href})`;
    },
  };
}

/**
 * Table rule → GFM pipe tables. Turndown's default leaves raw HTML; inline
 * here rather than pulling in `turndown-plugin-gfm` for one feature.
 *
 * ⚠ **EACH CELL IS CONVERTED AS INLINE MARKDOWN, NOT READ AS TEXT.** This read
 * `textContent`, so every editor save stripped links, bold, italic, code and
 * strike out of agent-written tables. `cellToMarkdown` is a turndown with the
 * prose rules, so a cell serialises like prose does; {@link toCellMarkdown}
 * then makes it legal on one table line.
 */
export function makeTableRule(
  cellToMarkdown: (html: string) => string
): TurndownService.Rule {
  return {
    filter: "table",
    replacement(_content, node) {
      const table = node as HTMLTableElement;
      const rows: string[][] = [];
      for (const row of Array.from(table.rows)) {
        rows.push(
          Array.from(row.cells).map((c) =>
            toCellMarkdown(cellToMarkdown(c.innerHTML))
          )
        );
      }
      if (rows.length === 0) return "";
      const aligns = Array.from(table.rows[0].cells).map(cellAlign);
      const widths = rows[0].map(() => 3);
      const fmt = (cells: string[]) =>
        "| " +
        cells.map((c, i) => c.padEnd(widths[i] ?? 3, " ")).join(" | ") +
        " |";
      const sep =
        "| " + widths.map((w, i) => alignRule(aligns[i] ?? null, w)).join(" | ") + " |";
      const out = [fmt(rows[0]), sep, ...rows.slice(1).map(fmt)];
      return "\n\n" + out.join("\n") + "\n\n";
    },
  };
}

/**
 * One cell's markdown, made to fit on a table line — the inverse of what
 * `marked` (GFM) reads back:
 * - line and paragraph breaks → `<br>`: marked emits it, Tiptap reads it as a
 *   hard break, turndown writes that as `"  \n"`, and this turns it back;
 * - EVERY `|` → `\|`, inside code spans too: GFM unescapes `\|` in a cell
 *   before inline parsing, and turndown already writes a literal `\` as `\\`.
 */
export function toCellMarkdown(md: string): string {
  return md
    .trim()
    .replace(/ *\n+ */g, "<br>")
    .replace(/\|/g, "\\|");
}

type Align = "left" | "center" | "right" | null;

/** Tiptap renders a cell's alignment as `style="text-align: …"`; marked as `align`. */
function cellAlign(cell: HTMLTableCellElement): Align {
  const raw = (cell.style.textAlign || cell.getAttribute("align") || "")
    .trim()
    .toLowerCase();
  return raw === "left" || raw === "center" || raw === "right" ? raw : null;
}

function alignRule(align: Align, width: number): string {
  const dashes = "-".repeat(width);
  if (align === "center") return `:${dashes}:`;
  if (align === "left") return `:${dashes}`;
  if (align === "right") return `${dashes}:`;
  return dashes;
}

/** `<s>`/`<del>` → GFM `~~…~~`, which `marked` reads back as `<del>`. ⚠ Turndown
 *  has no strike rule of its own: without this every save flattened strike to text. */
export function makeStrikeRule(): TurndownService.Rule {
  return {
    filter: ["del", "s", "strike"] as TurndownService.Filter,
    replacement: (content) => (content ? `~~${content}~~` : ""),
  };
}

function baseTurndown(): TurndownService {
  const td = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    bulletListMarker: "-",
    emDelimiter: "*",
    linkStyle: "inlined",
  });
  td.addRule("link", makeLinkRule()); // ⚠ overrides built-in inlineLink — see makeLinkRule
  td.addRule("strike", makeStrikeRule());
  return td;
}

/** The KB editor's HTML → markdown converter: prose rules, plus GFM tables whose
 *  cells go through a sibling converter with the same prose rules. */
export function createDocTurndown(): TurndownService {
  const cells = baseTurndown();
  const td = baseTurndown();
  td.addRule("table", makeTableRule((html) => cells.turndown(html)));
  return td;
}
