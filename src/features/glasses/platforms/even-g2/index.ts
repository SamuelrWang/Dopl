import type { GlassesPlatform } from "../types";
import { compileScreen } from "./compile";
import { RENDER_HINT, SCREEN_LIMITS, capabilities } from "./display";
import { EVEN_G2_INFO } from "./info";
import { renderPreview } from "./preview";
import { sanitizeG2Text, wrapCardLines } from "./text";

export const evenG2: GlassesPlatform = {
  ...EVEN_G2_INFO,
  capabilities,
  renderHint: RENDER_HINT,
  screenLimits: SCREEN_LIMITS,
  compileScreen: (spec, screenId) => compileScreen(spec, screenId),
  previewScreen: renderPreview,
  sanitizeText: sanitizeG2Text,
  wrapCardLines: (text, budget) => wrapCardLines(text, budget),
};
