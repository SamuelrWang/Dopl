import { getTextWidth, measureTextWrap } from "@evenrealities/pretext";

/**
 * G2 text metrics from `@evenrealities/pretext`, which carries the firmware's
 * glyph advance table and mirrors LVGL's line breaking, so server-side layout
 * matches what the lens draws. Pure arithmetic: no DOM needed.
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
