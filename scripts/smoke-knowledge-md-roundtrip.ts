/**
 * Item 5.A.2 — verify the seeded fixtures don't drift visibly through
 * the Tiptap editor's markdown ↔ HTML round-trip.
 *
 * Pipeline mirror:
 *   md → marked.parse → HTML → Tiptap (no transform here, we trust it)
 *   HTML → turndown.turndown → md
 *
 * We can't run Tiptap headlessly without a JSDOM polyfill, so we
 * approximate the round-trip with marked → turndown only. That's the
 * lossy step in practice — Tiptap preserves the parsed structure
 * faithfully; the lossy bits are the HTML serialization that turndown
 * has to interpret.
 *
 * Reports drift as a unified-style diff per fixture. No DB writes.
 *
 * Usage:
 *   npx tsx scripts/smoke-knowledge-md-roundtrip.ts
 */
import { marked } from "marked";
import TurndownService from "turndown";
import { HARDCODED_KBS } from "../src/features/knowledge/server/seed-fixtures-data";

function makeTurndown(): TurndownService {
  const td = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    bulletListMarker: "-",
    emDelimiter: "*",
  });
  td.addRule("table", {
    filter: "table",
    replacement(_content, node) {
      const table = node as HTMLTableElement;
      const rows: string[][] = [];
      for (const row of Array.from(table.rows)) {
        rows.push(
          Array.from(row.cells).map((c) =>
            c.textContent?.trim().replace(/\|/g, "\\|") ?? ""
          )
        );
      }
      if (rows.length === 0) return "";
      const widths = rows[0].map(() => 3);
      const fmt = (cells: string[]) =>
        "| " +
        cells.map((c, i) => c.padEnd(widths[i] ?? 3, " ")).join(" | ") +
        " |";
      const sep = "| " + widths.map((w) => "-".repeat(w)).join(" | ") + " |";
      const out = [fmt(rows[0]), sep, ...rows.slice(1).map(fmt)];
      return "\n\n" + out.join("\n") + "\n\n";
    },
  });
  return td;
}

function roundtrip(md: string, td: TurndownService): string {
  const html = marked.parse(md, { async: false, gfm: true });
  if (typeof html !== "string") throw new Error("marked returned non-string");
  return td.turndown(html);
}

/**
 * Compare two markdown strings, treating cosmetic whitespace as equal.
 *
 * Turndown is consistent on visible structure but emits more whitespace
 * around list markers and tables than `marked` typically expects:
 *   - `1.  ` instead of `1. ` (numbered list marker, two spaces)
 *   - `-   ` instead of `- `  (bullet list marker)
 *   - `> ` instead of `>` for empty blockquote continuation lines
 *
 * Tiptap/Prose render both forms identically, so this normalization
 * filters them out. The remaining diff (if any) is real semantic drift.
 */
function normalize(s: string): string {
  const collapsed = s
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    // Collapse N spaces after list markers to a single space.
    .replace(/^(\s*\d+\.)\s+/gm, "$1 ")
    .replace(/^(\s*-)\s+/gm, "$1 ")
    .replace(/^(\s*\*)\s+/gm, "$1 ")
    // Trailing whitespace on blockquote continuation lines.
    .replace(/^>[ \t]+$/gm, ">")
    // Trailing whitespace on any line.
    .replace(/[ \t]+$/gm, "")
    // turndown escapes `.` after numerals in headings to prevent them
    // from being parsed as list markers (`## 2\. Foo`). Both render as
    // the same heading. Unescape.
    .replace(/^(#{1,6}\s+\d+)\\\.\s/gm, "$1. ")
    // turndown emits `* * *` for horizontal rules; we use `---` in the
    // fixtures. Both are valid GFM hr.
    .replace(/^\* \* \*$/gm, "---")
    .trim();
  // Table row alignment padding — turndown pads cells to visually
  // align columns; both render identically. Normalize each table row
  // by splitting on `|`, trimming cells, rejoining with `| … |`.
  return collapsed
    .split("\n")
    .map((line) => {
      if (!/^\s*\|.*\|\s*$/.test(line)) return line;
      const cells = line.split("|");
      return cells.map((c) => c.trim()).join(" | ").replace(/^ \| /, "| ").replace(/ \| $/, " |");
    })
    .join("\n");
}

function unifiedDiff(a: string, b: string, label: string): string {
  const aLines = a.split("\n");
  const bLines = b.split("\n");
  const out: string[] = [`--- ${label} (original)`, `+++ ${label} (round-trip)`];
  const max = Math.max(aLines.length, bLines.length);
  for (let i = 0; i < max; i++) {
    if (aLines[i] !== bLines[i]) {
      if (aLines[i] !== undefined) out.push(`- ${aLines[i]}`);
      if (bLines[i] !== undefined) out.push(`+ ${bLines[i]}`);
    } else if (aLines[i] !== undefined) {
      out.push(`  ${aLines[i]}`);
    }
  }
  return out.join("\n");
}

async function main() {
  // Need JSDOM-like environment for turndown's table rule. Try the
  // minimal-viable path first — run with @ts-ignore for Node.
  // turndown ships with a built-in DOM parser via collapse-whitespace
  // when running in Node? Let's see — try and report errors clearly.
  let td: TurndownService;
  try {
    td = makeTurndown();
    // Force a quick dry run to surface any "document is undefined" errors.
    td.turndown("<p>hello</p>");
  } catch (err) {
    console.error(
      "❌ Turndown can't run in Node without a DOM polyfill. Install jsdom or run this in a browser context."
    );
    console.error(err);
    process.exit(1);
  }

  let drifts = 0;
  let checked = 0;
  for (const kb of HARDCODED_KBS) {
    for (const entry of kb.entries) {
      checked += 1;
      const original = normalize(entry.body);
      const reconstructed = normalize(roundtrip(entry.body, td));
      if (original === reconstructed) continue;
      drifts += 1;
      console.log(`\n⚠️  Drift in ${kb.slug} → ${entry.title}`);
      console.log(unifiedDiff(original, reconstructed, entry.title));
    }
  }

  console.log(`\n${checked - drifts}/${checked} entries round-trip clean.`);
  if (drifts > 0) {
    console.log(
      `\nDrift is documented above. Item 5 polish does not commit to fixing these — track in REFACTOR-FINDINGS.md if severe.`
    );
  } else {
    console.log("All seeded fixtures round-trip without visible drift.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
