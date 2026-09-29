import { DISPLAY_LIMITS, type DisplayBlock } from "./types";

/**
 * **THE TEXT-ONLY RENDERING** (spec §2.5, last column) — the `body` every display message
 * carries, and what every surface that does not draw displays shows (an MCP read, the glasses
 * inbox, an older app). Capped at {@link DISPLAY_LIMITS.fallback} chars.
 */

const pct = (v: number) => `${Math.round(v * 100)}%`;

export function blockFallbackLines(b: DisplayBlock): string[] {
  switch (b.type) {
    case "heading":
      return [b.text];
    case "text":
      return [b.content];
    case "fields":
      return b.rows.map((r) => `${r.label}: ${r.value}`);
    case "list":
      return b.items.map((item, i) => (b.style === "number" ? `${i + 1}. ${item}` : `- ${item}`));
    case "choice": {
      const lines = b.options.map(
        (o, i) => `${i + 1}. ${o.label}${o.description ? ` — ${o.description}` : ""}${o.recommended ? " (recommended)" : ""}`
      );
      const rec = b.options.findIndex((o) => o.recommended);
      if (rec >= 0 && b.options[rec].why) lines.push(`Recommended: ${rec + 1}. ${b.options[rec].label} — ${b.options[rec].why}`);
      return lines;
    }
    case "progress":
      return [`${b.label ? `${b.label} ` : ""}${pct(b.value)}`];
    case "table":
      return [b.columns, ...b.rows].map((r) => r.join(" | "));
    case "divider":
      return ["---"];
    case "spacer":
      return [""];
  }
}

export function displayFallback(blocks: readonly DisplayBlock[]): string {
  const text = blocks
    .flatMap(blockFallbackLines)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const max = DISPLAY_LIMITS.fallback;
  if (!text) return "Display";
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
