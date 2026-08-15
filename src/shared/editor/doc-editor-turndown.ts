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
