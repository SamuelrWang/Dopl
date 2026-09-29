import type { Sanitize } from "./validation";

/**
 * Channel markdown as plain lens text: markdown flattened, embeds reduced to
 * short notes (`[image]`, `[file: name]`), then the display's sanitizer. Line and paragraph
 * breaks are kept (runs of blank lines fold to one); a card wraps on whitespace anyway. One
 * implementation for mirrored replies and the read / conversation screens.
 */

const FILE_EXT = /\.(pdf|zip|csv|tsv|txt|md|json|docx?|xlsx?|pptx?|mp3|wav|mp4|mov|gz|tar)(\?|#|$)/i;

export interface ChannelText {
  text: string;
  /** Non-text parts, e.g. `["[image]", "[file: report.pdf]"]`. */
  notes: string[];
}

export function flattenChannelText(body: string, sanitize: Sanitize): ChannelText {
  const notes: string[] = [];
  const note = (n: string) => {
    notes.push(n);
    return ` ${n} `;
  };
  const text = sanitize(
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
      .replace(/^#{1,6}[ \t]+/gm, "")
      .replace(/^[ \t]*[-*][ \t]+/gm, "- ")
      .replace(/[ \t]*\r?\n[ \t]*/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim(),
  );
  return { text, notes };
}
