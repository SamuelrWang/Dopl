import { getTextWidth, measureTextWrap } from "@evenrealities/pretext";

/**
 * G2 text metrics. Backed by `@evenrealities/pretext` (MIT, Even Realities),
 * which carries the firmware's own glyph advance table and mirrors LVGL's
 * line-breaking — so server-side layout matches what the glasses draw.
 * Pure data + arithmetic: runs in Node with no DOM.
 */
export interface TextMeasurer {
  /** Wrapped line count of `text` inside `maxWidth` px (at least 1). */
  lineCount(text: string, maxWidth: number): number;
  /** Single-line width in px. */
  width(text: string): number;
}

export const g2Measurer: TextMeasurer = {
  lineCount(text, maxWidth) {
    return Math.max(1, measureTextWrap(text, Math.max(1, maxWidth)).lineCount);
  },
  width(text) {
    return getTextWidth(text);
  },
};
