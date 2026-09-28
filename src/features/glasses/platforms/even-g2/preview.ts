import type { ScreenPayload } from "../../core/messages/types";
import { SCREEN_H, SCREEN_W } from "./display";

/**
 * An ASCII mock of a compiled screen so an agent can SEE its layout before
 * sending it: a COLS x ROWS grid (one cell ~ 9x18 px) inside a frame. Each
 * container starts with `[id]` (`[id*]` = takes input); lists show `> item`.
 * Widths are in characters, not G2 pixels.
 */
const PREVIEW_COLS = 64;
const PREVIEW_ROWS = 16;

export function renderPreview({ containers, nav_footer: navFooter }: ScreenPayload): string {
  const cw = SCREEN_W / PREVIEW_COLS;
  const ch = SCREEN_H / PREVIEW_ROWS;
  const grid = Array.from({ length: PREVIEW_ROWS }, () => Array<string>(PREVIEW_COLS).fill(" "));

  for (const c of containers) {
    const c0 = Math.min(PREVIEW_COLS - 1, Math.round(c.x / cw));
    const r0 = Math.min(PREVIEW_ROWS - 1, Math.round(c.y / ch));
    const c1 = Math.max(c0, Math.min(PREVIEW_COLS - 1, Math.round((c.x + c.w) / cw) - 1));
    const r1 = Math.max(r0, Math.min(PREVIEW_ROWS - 1, Math.round((c.y + c.h) / ch) - 1));
    const width = c1 - c0 + 1;
    const tag = `[${c.block_id}${c.capture ? "*" : ""}] `;
    const lines =
      c.kind === "list"
        ? (c.items ?? []).map((item) => `> ${item}`)
        : wrap(toAscii(c.content ?? "").replace(/\n/g, " "), width);
    const rows = [tag + (lines[0] ?? ""), ...lines.slice(1)];
    for (let r = r0; r <= r1; r++) {
      const text = rows[r - r0] ?? "";
      for (let k = 0; k < width; k++) grid[r][c0 + k] = text[k] ?? " ";
    }
  }
  if (navFooter) {
    const r = Math.min(PREVIEW_ROWS - 1, Math.round(navFooter.y / ch));
    const label = "< [back button]";
    for (let k = 0; k < PREVIEW_COLS; k++) grid[r][k] = label[k] ?? " ";
  }
  const frame = "+" + "-".repeat(PREVIEW_COLS) + "+";
  return [frame, ...grid.map((row) => "|" + row.join("") + "|"), frame].join("\n");
}

/** The G2 glyphs the compiler emits, as ASCII look-alikes. */
const ASCII: Record<string, string> = { "\u2588": "#", "\u2592": ".", "\u2500": "-" };
const toAscii = (s: string) => s.replace(/[\u2588\u2592\u2500]/g, (g) => ASCII[g]);

function wrap(text: string, width: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += width) out.push(text.slice(i, i + width));
  return out.length ? out : [""];
}
