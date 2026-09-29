import type { ChatDisplay } from "../types";
import { normalizeSpec, type NormBlock } from "../../core/screens/normalize";
import type { ScreenError } from "../../core/screens/spec";
import { clampBytes } from "../../core/validation";
import { fitLens, toLensPrimitives, type LensPrimitives } from "@/features/display/core/degrade";
import type { DisplayBlock, Positioned } from "@/features/display/core/types";
import { box, INFO_MARK, size, textHeight, toContainer, type Sized } from "./compile";
import {
  CHAT_AREA,
  CHAT_MAX_CONTAINERS,
  CHAT_MAX_PAGES,
  DIVIDER_GLYPH,
  LINE_H,
  MARGIN,
  PROGRESS_EMPTY,
  PROGRESS_FILLED,
  SCREEN_LIMITS as LIM,
} from "./display";
import { g2Measurer, type TextMeasurer } from "./measure";
import { sanitizeG2Text } from "./text";

/**
 * **A CHANNEL DISPLAY ON THE READ / CONVERSATION PAGE** (docs/glasses-mcp.md › Menu). The v2
 * blocks go through the display degradation ladder (`display/core/degrade.ts`, chat mode), are
 * re-checked under the G2 limits and stacked into {@link CHAT_AREA} (x 8-568, y 30-202) with the
 * lens font. The one choice is NOT laid out: the plugin shows it as the page's footer list, the
 * only input container. Absolute layouts are stacked (the chat area is not the full lens).
 *
 * Nothing ever reaches below the area: every container is text (an info list is `─ item` lines,
 * never a G2 list, which draws 40px rows and a selection border), measured with the G2 font. What
 * does not fit continues on the next page (`pages`, at most {@link CHAT_MAX_PAGES}): a text block
 * fills the page and continues (by line, then word; two lines at least on each side), any other
 * block that fits a fresh page moves there whole. Past the page cap the ladder shortens the
 * display; nothing that fits at any level falls back to {@link displayText}, paged the same way
 * and cut with `+N more`.
 */

type Container = ChatDisplay["containers"][number];
type Page = Container[];

const AREA = { x: CHAT_AREA.x + MARGIN, y: CHAT_AREA.y, w: CHAT_AREA.w - 2 * MARGIN, h: CHAT_AREA.h };
const BAR_CELLS = 10;
/** A text split across pages keeps at least this many lines on each side. */
const MIN_SPLIT_LINES = 2;
const OPTION_MARK = "▶ ";

const bar = (value: number) => {
  const filled = Math.round(value * BAR_CELLS);
  return PROGRESS_FILLED.repeat(filled) + PROGRESS_EMPTY.repeat(BAR_CELLS - filled);
};

/** The display as multi-line lens text: title/text, `label ███▒▒ 32%`, `─ info`, `▶ option`. */
function displayText(blocks: NormBlock[], options: string[] = []): string {
  const lines: string[] = [];
  for (const b of blocks) {
    if (b.type === "text" && b.content) lines.push(b.content);
    else if (b.type === "progress") {
      const value = b.value ?? 0;
      lines.push(`${b.label ? `${b.label} ` : ""}${bar(value)} ${Math.round(value * 100)}%`);
    } else if (b.type === "divider") lines.push(DIVIDER_GLYPH.repeat(BAR_CELLS));
    else if (b.type === "spacer") lines.push("");
    else if (b.type === "list") lines.push(...(b.items ?? []).map((item) => (b.selectable ? OPTION_MARK : INFO_MARK) + item));
  }
  lines.push(...options.map((o) => OPTION_MARK + o));
  return sanitizeG2Text(lines.join("\n").replace(/\n{3,}/g, "\n\n"));
}

const normalize = (p: LensPrimitives) => normalizeSpec({ blocks: p.blocks, layout: "stack" }, { limits: LIM, sanitize: sanitizeG2Text });

/** The head of `content` that wraps to at most `maxLines` lines (cut by line, then word, then character) and the rest. */
function splitText(content: string, inner: number, maxLines: number, m: TextMeasurer): [string, string] {
  const fits = (s: string) => m.lineCount(s, inner) <= maxLines;
  if (fits(content)) return [content, ""];
  const lines = content.split("\n");
  let k = 0;
  while (k < lines.length && fits(lines.slice(0, k + 1).join("\n"))) k++;
  if (k > 0) return [lines.slice(0, k).join("\n"), lines.slice(k).join("\n")];
  const words = lines[0].split(" ");
  let w = 0;
  while (w < words.length && fits(words.slice(0, w + 1).join(" "))) w++;
  let head: string;
  let tail: string;
  if (w > 0) {
    head = words.slice(0, w).join(" ");
    tail = words.slice(w).join(" ");
  } else {
    const chars = Array.from(lines[0]);
    let c = 1;
    while (c < chars.length && fits(chars.slice(0, c + 1).join(""))) c++;
    head = chars.slice(0, c).join("");
    tail = chars.slice(c).join("");
  }
  return [head, [tail, ...lines.slice(1)].join("\n")];
}

/**
 * Stack blocks into chat-area pages: top-down from y 30, full width, never below y 202, at most
 * {@link CHAT_MAX_CONTAINERS} per page. A spacer is dropped at a page break.
 */
function paginateChat(blocks: NormBlock[], m: TextMeasurer, errors: ScreenError[]): Page[] {
  const pages: Page[] = [[]];
  let used = 0;
  const current = () => pages[pages.length - 1];
  const nextPage = () => {
    pages.push([]);
    used = 0;
  };
  const place = (s: Sized) => {
    const c = toContainer(s, AREA.x, AREA.y + used, AREA.w, s.natural);
    if (c) {
      const out: Container & { capture?: boolean } = { ...c };
      delete out.capture;
      current().push(out);
    }
    used += s.natural;
  };
  for (const block of blocks) {
    let s: Sized | null = size(block, AREA.w, m, errors);
    if (!s) continue;
    if (s.block.type === "spacer") {
      if (current().length && used + s.natural <= AREA.h) used += s.natural;
      continue;
    }
    for (;;) {
      const room = current().length >= CHAT_MAX_CONTAINERS ? 0 : AREA.h - used;
      if (s.natural <= room) {
        place(s);
        break;
      }
      const b: NormBlock = s.block;
      // A text flows: it fills what is left here and continues on the next page, keeping at least
      // two lines on each side (else a text that fits a fresh page moves there whole).
      if (b.type === "text") {
        const inner = AREA.w - box(b.border);
        const total = m.lineCount(s.content ?? "", inner);
        const lines = Math.min(Math.floor((room - box(b.border)) / LINE_H), total - MIN_SPLIT_LINES);
        const [head, tail]: [string, string] = lines >= MIN_SPLIT_LINES ? splitText(s.content ?? "", inner, lines, m) : ["", ""];
        if (head && tail) {
          const part: NormBlock = { ...b, lines: undefined };
          place({ block: part, content: head, natural: textHeight(head, AREA.w, b.border, m) });
          nextPage();
          s = { block: part, content: tail, natural: textHeight(tail, AREA.w, b.border, m) };
          continue;
        }
      }
      if (!current().length) {
        errors.push({ block: b.id, code: "overflow", message: `${b.id} is ${s.natural}px; the chat area is ${AREA.h}px` });
        return [];
      }
      nextPage();
    }
  }
  if (!current().length && pages.length > 1) pages.pop();
  return pages;
}

const textBlock = (content: string): NormBlock => ({ id: "fallback", type: "text", content, border: false, selectable: false });

/** The text rendering as pages: whole when it fits {@link CHAT_MAX_PAGES}, else its first lines and `+N more`. */
function fallbackPages(text: string, m: TextMeasurer): Page[] {
  const pagesOf = (t: string) => paginateChat([textBlock(t || " ")], m, []);
  const whole = pagesOf(text);
  if (whole.length <= CHAT_MAX_PAGES) return whole;
  const lines = text.split("\n");
  const cut = (keep: number) => pagesOf([...lines.slice(0, keep), `+${lines.length - keep} more`].join("\n"));
  let lo = 0;
  let hi = lines.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (cut(mid).length <= CHAT_MAX_PAGES) lo = mid;
    else hi = mid - 1;
  }
  return cut(lo).slice(0, CHAT_MAX_PAGES);
}

export function compileChatDisplay(blocks: Positioned<DisplayBlock>[], m: TextMeasurer = g2Measurer): ChatDisplay {
  const fit = fitLens<Page[], ScreenError>(blocks, "stack", { mode: "chat", itemBytes: LIM.list_item_bytes }, (p) => {
    const { blocks: norm, errors } = normalize(p);
    if (errors.length) return { ok: false, errors };
    if (norm.length === 0) return { ok: true, payload: [[]] };
    const pages = paginateChat(norm, m, errors);
    if (errors.length) return { ok: false, errors };
    if (pages.length > CHAT_MAX_PAGES) {
      return { ok: false, errors: [{ code: "overflow", message: `${pages.length} chat pages; max ${CHAT_MAX_PAGES}` }] };
    }
    return { ok: true, payload: pages };
  });
  // The level-0 rendering carries every word, for the text field and the fallback.
  const whole = toLensPrimitives(blocks, { mode: "chat", level: 0, itemBytes: LIM.list_item_bytes });
  const shown = fit.ok ? fit.primitives : whole;
  const options = shown.options && {
    ...shown.options,
    items: shown.options.items.map((i) => clampBytes(sanitizeG2Text(i), LIM.list_item_bytes)),
  };
  const text = displayText(normalize(whole).blocks, options?.items ?? []);
  const pages = fit.ok ? fit.payload : fallbackPages(text, m);
  return { containers: pages[0], pages, options, text, fallback: !fit.ok };
}
