import TurndownService from "turndown";

/**
 * Turndown rules used by the KB doc editor's HTML→markdown round-trip.
 * Extracted from `doc-editor.tsx` to keep the editor file under the
 * §2 line cap; behaviour is unchanged.
 */

/**
 * Custom turndown rule for anchor tags. Mirrors GFM-style inline links
 * `[text](href "title")`. Bypasses turndown's default rule entirely so
 * extra Tiptap-injected attributes (class, target, rel) can't cause
 * the rule to skip — every `a[href]` round-trips deterministically.
 */
export function makeLinkRule(): TurndownService.Rule {
  return {
    filter: (node) =>
      node.nodeName === "A" && !!(node as HTMLAnchorElement).getAttribute("href"),
    replacement(content, node) {
      const a = node as HTMLAnchorElement;
      const href = a.getAttribute("href") ?? "";
      const title = a.getAttribute("title");
      // `content` is the already-converted markdown for the link's
      // text. Empty content (autolink case) — fall back to the URL.
      const text = content.trim() || href;
      return title ? `[${text}](${href} "${title}")` : `[${text}](${href})`;
    },
  };
}

/**
 * Tiny custom turndown rule for tables — turndown's default leaves
 * tables as raw HTML; we want GFM pipe tables back. Inline rather
 * than pulling in `turndown-plugin-gfm` for one feature.
 */
export function makeTableRule(): TurndownService.Rule {
  return {
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
  };
}
