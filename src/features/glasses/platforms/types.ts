import type { ScreenContainer, ScreenPayload } from "../core/messages/types";
import type { NormBlock } from "../core/screens/normalize";
import type { ScreenError, ScreenLimits } from "../core/screens/spec";
import type { PlatformInfo } from "./info";

/**
 * A channel display (`metadata.display`) compiled for the plugin's Read / Conversation page:
 * positioned containers in the chat area (lens px, never input), the one selectable list apart
 * (the plugin shows it as the footer list), and a multi-line text rendering. `fallback` = the
 * blocks did not fit, so `containers` is that text in one container.
 */
export interface ChatDisplay {
  containers: Omit<ScreenContainer, "capture">[];
  options: { block_id: string; items: string[] } | null;
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
  compileChatDisplay(blocks: NormBlock[]): ChatDisplay;
  /** An ASCII mock of a compiled screen, for `validate_only`. */
  previewScreen(payload: ScreenPayload): string;
  /** Fold text to what the display can draw. */
  sanitizeText(input: string): string;
  /** Wrap card text to the display's line width within the card budget. */
  wrapCardLines(text: string, budget: { maxLines: number; maxLineBytes: number }): string[];
}
