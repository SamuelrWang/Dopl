import type { GlassesPlatform } from "../../platforms/types";
import type { LensOptions } from "@/features/display/core/degrade";
import type { Display, DisplayAnswerStamp } from "@/features/display/core/types";

/**
 * A channel message's display (`display/core/adapt.ts › displayOf`: v2, v1, or a legacy decision)
 * → the device's `display` field (docs/glasses-mcp.md › Menu › Display messages; contract C3):
 * compiled by the device's platform for the Read / Conversation chat area, the choice apart as
 * `options` (recommended index; items already carry ` (rec)` when it fits), and the answer state.
 */

export interface LensDisplay {
  /** The display id (`screen_id` on the wire, kept for the plugin). */
  screen_id: string;
  containers: ReturnType<GlassesPlatform["compileChatDisplay"]>["containers"];
  options: LensOptions | null;
  answer: DisplayAnswerStamp | null;
  /** Present (true) only when the blocks did not fit and `containers` is the text rendering. */
  fallback?: true;
  /** Present (true) when answering it is a decision (a channel card with an answer message). */
  decision?: true;
}

/** The display and its multi-line text rendering (the message's `text`). */
export function lensDisplay(
  display: Display,
  platform: Pick<GlassesPlatform, "compileChatDisplay" | "sanitizeText">,
): { text: string; display: LensDisplay } {
  const compiled = platform.compileChatDisplay(display.blocks);
  const answer = display.answer && { ...display.answer, choice: platform.sanitizeText(display.answer.choice) };
  return {
    text: compiled.text,
    display: {
      screen_id: display.display_id,
      containers: compiled.containers,
      options: compiled.options,
      answer,
      ...(compiled.fallback ? { fallback: true as const } : {}),
      ...(display.decision ? { decision: true as const } : {}),
    },
  };
}
