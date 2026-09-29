import type { ScreenContainer, ScreenPayload } from "../core/messages/types";
import type { DisplayBlock, Positioned } from "@/features/display/core/types";
import type { LensOptions } from "@/features/display/core/degrade";
import type { ScreenError, ScreenLimits } from "../core/screens/spec";
import type { PlatformInfo } from "./info";

/**
 * A channel display (`metadata.display`) compiled for the plugin's Read / Conversation page:
 * positioned containers in the chat area (lens px, never input, never below it), the one choice
 * apart (the plugin shows it as the footer list, recommended index included), and a multi-line
 * text rendering. A display taller than the area continues on further `pages` (each its own
 * reader page; `containers` = `pages[0]`). `fallback` = the blocks did not fit at any degradation
 * level, so the pages hold that text rendering.
 */
export interface ChatDisplay {
  containers: Omit<ScreenContainer, "capture">[];
  /** Every page, in order (at least one; the first is `containers`). */
  pages: Omit<ScreenContainer, "capture">[][];
  options: LensOptions | null;
  text: string;
  fallback: boolean;
}

export type CompileResult = { ok: true; payload: ScreenPayload } | { ok: false; errors: ScreenError[] };

/**
 * Everything core needs from a glasses platform. Core reaches an implementation
 * only through `registry.ts › glassesPlatform`, keyed by `glasses_device_links.platform`.
 */
export interface GlassesPlatform extends PlatformInfo {
  /** `glasses_capabilities`: display size, limits and block types. */
  capabilities(): Record<string, unknown>;
  /** One line for the `glasses_render` description: usable area and block budget. */
  renderHint: string;
  screenLimits: ScreenLimits;
  /** Blocks → the device's positioned containers, or fixable errors. */
  compileScreen(spec: unknown, screenId: string): CompileResult;
  /** A channel display for the Read / Conversation page's chat area (docs/glasses-mcp.md › Menu). */
  compileChatDisplay(blocks: Positioned<DisplayBlock>[]): ChatDisplay;
  /** An ASCII mock of a compiled screen, for `validate_only`. */
  previewScreen(payload: ScreenPayload): string;
  /** Fold text to what the display can draw. */
  sanitizeText(input: string): string;
  /** Wrap card text to the display's line width within the card budget. */
  wrapCardLines(text: string, budget: { maxLines: number; maxLineBytes: number }): string[];
}
