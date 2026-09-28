import type { ScreenPayload } from "../core/messages/types";
import type { ScreenError, ScreenLimits } from "../core/screens/spec";
import type { PlatformInfo } from "./info";

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
  /** An ASCII mock of a compiled screen, for `validate_only`. */
  previewScreen(payload: ScreenPayload): string;
  /** Fold text to what the display can draw. */
  sanitizeText(input: string): string;
  /** Wrap card text to the display's line width within the card budget. */
  wrapCardLines(text: string, budget: { maxLines: number; maxLineBytes: number }): string[];
}
