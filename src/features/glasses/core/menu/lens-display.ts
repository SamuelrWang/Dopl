import type { GlassesPlatform } from "../../platforms/types";
import { normalizeDisplay, type DisplayAnswerStamp } from "../screens/display";
import type { Sanitize } from "../validation";

/**
 * `metadata.display` on a channel message → the device's `display` field (docs/glasses-mcp.md ›
 * Menu › Display messages): compiled by the device's platform for the Read / Conversation chat
 * area, the selectable list apart as `options`, and the answer state. The stored stamp is
 * server-written, but it is re-validated here: a row that fails is shown as a plain message.
 */

export interface LensDisplay {
  screen_id: string;
  containers: ReturnType<GlassesPlatform["compileChatDisplay"]>["containers"];
  options: { block_id: string; items: string[] } | null;
  answer: DisplayAnswerStamp | null;
  /** Present (true) only when the blocks did not fit and `containers` is the text rendering. */
  fallback?: true;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function answerOf(raw: unknown, sanitize: Sanitize): DisplayAnswerStamp | null {
  if (!isObj(raw) || typeof raw.choice !== "string" || typeof raw.index !== "number") return null;
  return {
    block_id: typeof raw.block_id === "string" ? raw.block_id : null,
    choice: sanitize(raw.choice),
    index: raw.index,
    at: typeof raw.at === "string" ? raw.at : "",
    via: typeof raw.via === "string" ? raw.via : "web",
  };
}

/** The display and its multi-line text rendering (the message's `text`), or null. */
export function lensDisplay(
  raw: unknown,
  platform: Pick<GlassesPlatform, "compileChatDisplay" | "sanitizeText">,
): { text: string; display: LensDisplay } | null {
  if (!isObj(raw) || !Array.isArray(raw.blocks)) return null;
  const checked = normalizeDisplay({ blocks: raw.blocks, layout: raw.layout });
  if (!checked.ok) return null;
  const compiled = platform.compileChatDisplay(checked.blocks);
  return {
    text: compiled.text,
    display: {
      screen_id: typeof raw.screen_id === "string" ? raw.screen_id : "",
      containers: compiled.containers,
      options: compiled.options,
      answer: answerOf(raw.answer, platform.sanitizeText),
      ...(compiled.fallback ? { fallback: true as const } : {}),
    },
  };
}
