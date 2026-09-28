import { utf8Bytes } from "../../core/validation";
import { g2Measurer, type TextMeasurer } from "./measure";
import { CARD_LINE_WIDTH_PX } from "./display";

/**
 * The G2 font draws a narrow character set and fails SILENTLY on anything else
 * (curly quotes, long dashes, emoji), so every string bound for the lens is
 * folded to what it can draw.
 */

const SINGLE_QUOTES = /[‘’‚‛′]/g;
const DOUBLE_QUOTES = /[“”„‟″]/g;
const DASHES = /[‒–—―−]/g;
const ELLIPSIS = /…/g;
const NBSP = /[   ]/g;
// Surrogate pairs, BMP pictographs/dingbats, variation selectors, zero-width
// joiners and keycap combiners: every emoji building block.
const EMOJI_OR_NON_BMP =
  /[\uD800-\uDBFF][\uDC00-\uDFFF]|[\uD800-\uDFFF]|[☀-➿⬀-⯿⌀-⏿︀-️​-‍⃣]/g;

export function sanitizeG2Text(input: string): string {
  return input
    .replace(SINGLE_QUOTES, "'")
    .replace(DOUBLE_QUOTES, '"')
    .replace(DASHES, "-")
    .replace(ELLIPSIS, "...")
    .replace(NBSP, " ")
    .replace(EMOJI_OR_NON_BMP, "")
    .replace(/[ \t]+/g, " ")
    .trim();
}

const CUT_MARK = "…";

/** Word-wrap to the card's pixel width and a byte cap; the last kept line ends in … when cut. */
export function wrapCardLines(
  text: string,
  { maxLines, maxLineBytes }: { maxLines: number; maxLineBytes: number },
  m: TextMeasurer = g2Measurer,
): string[] {
  const fits = (s: string) => m.width(s) <= CARD_LINE_WIDTH_PX && utf8Bytes(s) <= maxLineBytes;
  const lines: string[] = [];
  let cur = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = cur ? `${cur} ${word}` : word;
    if (fits(next)) {
      cur = next;
      continue;
    }
    if (cur) lines.push(cur);
    cur = word;
    while (!fits(cur)) {
      let cut = cur.length - 1;
      while (cut > 1 && !fits(cur.slice(0, cut))) cut--;
      lines.push(cur.slice(0, cut));
      cur = cur.slice(cut);
    }
  }
  if (cur) lines.push(cur);
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  let last = kept[maxLines - 1];
  while (last && !fits(last + CUT_MARK)) last = last.slice(0, -1);
  kept[maxLines - 1] = last.trimEnd() + CUT_MARK;
  return kept;
}
