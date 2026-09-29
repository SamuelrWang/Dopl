import type { ChatDisplay } from "../types";
import { normalizeSpec, type NormBlock } from "../../core/screens/normalize";
import type { ScreenError } from "../../core/screens/spec";
import { clampBytes } from "../../core/validation";
import { fitLens, toLensPrimitives, type LensPrimitives } from "@/features/display/core/degrade";
import type { DisplayBlock, Positioned } from "@/features/display/core/types";
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
 * **A CHANNEL DISPLAY ON THE READ / CONVERSATION PAGE** (docs/glasses-mcp.md › Menu). The v2
 * blocks go through the display degradation ladder (`display/core/degrade.ts`, chat mode), are
 * re-checked under the G2 limits and stacked into {@link CHAT_AREA} (x 8-568, y 30-202) with the
 * lens font. The one choice is NOT laid out: the plugin shows it as the page's footer list, the
 * only input container. Absolute layouts are stacked (the chat area is not the full lens).
 * Nothing that fits at any level falls back to one text container holding {@link displayText}.
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
export function displayText(blocks: NormBlock[], options: string[] = []): string {
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

export function compileChatDisplay(blocks: Positioned<DisplayBlock>[], m: TextMeasurer = g2Measurer): ChatDisplay {
  const fit = fitLens<ChatDisplay["containers"], ScreenError>(blocks, "stack", { mode: "chat", itemBytes: LIM.list_item_bytes }, (p) => {
    const { blocks: norm, errors } = normalize(p);
    if (errors.length || norm.filter((b) => b.type !== "spacer").length > CHAT_MAX_CONTAINERS) return { ok: false, errors };
    if (norm.length === 0) return { ok: true, payload: [] };
    const layoutErrors: ScreenError[] = [];
    const sized = norm.map((b) => size(b, AREA.w, m, layoutErrors)).filter((s): s is Sized => s !== null);
    const containers = layoutErrors.length ? [] : layoutStack(sized, layoutErrors, AREA);
    if (layoutErrors.length) return { ok: false, errors: layoutErrors };
    return {
      ok: true,
      payload: containers.map((c) => {
        const out: ChatDisplay["containers"][number] & { capture?: boolean } = { ...c };
        delete out.capture;
        return out;
      }),
    };
  });
  // The level-0 rendering carries every word, for the text field and the fallback.
  const whole = toLensPrimitives(blocks, { mode: "chat", level: 0, itemBytes: LIM.list_item_bytes });
  const shown = fit.ok ? fit.primitives : whole;
  const options = shown.options && {
    ...shown.options,
    items: shown.options.items.map((i) => clampBytes(sanitizeG2Text(i), LIM.list_item_bytes)),
  };
  const text = displayText(normalize(whole).blocks, options?.items ?? []);
  if (fit.ok) return { containers: fit.payload, options, text, fallback: false };
  return {
    containers: [{ block_id: "fallback", kind: "text", ...AREA, content: clampBytes(text, LIM.text_bytes) }],
    options,
    text,
    fallback: true,
  };
}
