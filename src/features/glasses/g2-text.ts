import { sanitizeGlassesText } from "./text";

/**
 * Channel text for the G2 lens: markdown flattened, embeds reduced to short
 * notes (`[image]`, `[file: name]`), then the glasses sanitizer (no emoji,
 * straight quotes, plain dashes). One implementation for mirrored replies and
 * the read / conversation screens.
 */

const FILE_EXT = /\.(pdf|zip|csv|tsv|txt|md|json|docx?|xlsx?|pptx?|mp3|wav|mp4|mov|gz|tar)(\?|#|$)/i;

export interface G2Text {
  text: string;
  /** Non-text parts, e.g. `["[image]", "[file: report.pdf]"]`. */
  notes: string[];
}

export function flattenForG2(body: string): G2Text {
  const notes: string[] = [];
  const note = (n: string) => {
    notes.push(n);
    return ` ${n} `;
  };
  const text = sanitizeGlassesText(
    body
      .replace(/```[\s\S]*?```/g, " [code] ")
      .replace(/!\[[^\]]*\]\([^)]*\)/g, () => note("[image]"))
      .replace(/data:image\/[a-z+]+;base64,[A-Za-z0-9+/=]+/g, () => note("[image]"))
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, label: string, url: string) =>
        FILE_EXT.test(url) ? note(`[file: ${label}]`) : label,
      )
      .replace(/`([^`]*)`/g, "$1")
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .replace(/(^|\s)[*_]([^*_]+)[*_](?=\s|$)/g, "$1$2")
      .replace(/^#{1,6}\s+/gm, "")
      .replace(/^\s*[-*]\s+/gm, "- ")
      .replace(/\s*\n\s*/g, " "),
  );
  return { text, notes };
}

/** Just the flattened text. */
export function plainReply(body: string): string {
  return flattenForG2(body).text;
}
