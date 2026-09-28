import type { ChatDisplay } from "../types";
import { normalizeSpec, type NormBlock } from "../../core/screens/normalize";
import type { ScreenError } from "../../core/screens/spec";
import { clampBytes } from "../../core/validation";
import { layoutStack, size, type Sized } from "./compile";
import {
  CHAT_AREA,
  CHAT_MAX_CONTAINERS,
  DIVIDER_GLYPH,
  MARGIN,
  PROGRESS_EMPTY,
  PROGRESS_FILLED,
  SCREEN_LIMITS as LIM,
} from "./display";
import { g2Measurer, type TextMeasurer } from "./measure";
import { sanitizeG2Text } from "./text";

/**
 * **A CHANNEL DISPLAY ON THE READ / CONVERSATION PAGE** (docs/glasses-mcp.md › Menu). The stored
 * blocks were validated under chat limits (`screens/display.ts`); here they are re-checked under
 * the G2 limits and stacked into {@link CHAT_AREA} (x 8-568, y 30-202) with the lens font. The
 * one selectable list is NOT laid out: the plugin shows it as the page's footer list, the only
 * input container. Absolute layouts are stacked (the chat area is not the full lens). Anything
 * that does not fit falls back to one text container holding {@link displayText}.
 */

const AREA = { x: CHAT_AREA.x + MARGIN, y: CHAT_AREA.y, w: CHAT_AREA.w - 2 * MARGIN, h: CHAT_AREA.h };
const BAR_CELLS = 10;
const INFO_MARK = `${DIVIDER_GLYPH} `;
const OPTION_MARK = "▶ ";

const bar = (value: number) => {
  const filled = Math.round(value * BAR_CELLS);
  return PROGRESS_FILLED.repeat(filled) + PROGRESS_EMPTY.repeat(BAR_CELLS - filled);
};

/** The display as multi-line lens text: title/text, `label ███▒▒ 32%`, `─ info`, `▶ option`. */
export function displayText(blocks: NormBlock[]): string {
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
  return sanitizeG2Text(lines.join("\n").replace(/\n{3,}/g, "\n\n"));
}

/** A stored block as a stack block: geometry dropped, everything else re-validated. */
const asStackBlock = (b: NormBlock): NormBlock => {
  const rest = { ...b };
  delete rest.x;
  delete rest.y;
  delete rest.w;
  delete rest.h;
  return rest;
};

export function compileChatDisplay(blocks: NormBlock[], m: TextMeasurer = g2Measurer): ChatDisplay {
  const selectable = blocks.find((b) => b.type === "list" && b.selectable) ?? null;
  const options = selectable
    ? { block_id: selectable.id, items: (selectable.items ?? []).map((i) => clampBytes(sanitizeG2Text(i), LIM.list_item_bytes)) }
    : null;
  const text = displayText(blocks);
  const fallback = (): ChatDisplay => ({
    containers: [{ block_id: "fallback", kind: "text", ...AREA, content: clampBytes(text, LIM.text_bytes) }],
    options,
    text,
    fallback: true,
  });

  const rest = blocks.filter((b) => b !== selectable).map(asStackBlock);
  if (rest.length === 0) return { containers: [], options, text, fallback: false };
  const { blocks: norm, errors } = normalizeSpec({ blocks: rest, layout: "stack" }, { limits: LIM, sanitize: sanitizeG2Text });
  if (errors.length || norm.filter((b) => b.type !== "spacer").length > CHAT_MAX_CONTAINERS) return fallback();
  const layoutErrors: ScreenError[] = [];
  const sized = norm.map((b) => size(b, AREA.w, m, layoutErrors)).filter((s): s is Sized => s !== null);
  const containers = layoutErrors.length ? [] : layoutStack(sized, layoutErrors, AREA);
  if (layoutErrors.length || containers.length === 0) return fallback();
  return {
    containers: containers.map((c) => {
      const out: ChatDisplay["containers"][number] & { capture?: boolean } = { ...c };
      delete out.capture;
      return out;
    }),
    options,
    text,
    fallback: false,
  };
}
