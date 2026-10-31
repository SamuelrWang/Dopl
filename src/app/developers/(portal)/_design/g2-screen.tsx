"use client";

/**
 * The Even G2's display, drawn the way the glasses draw it: a 576x288 framebuffer, 27px lines, hard
 * green pixels. Line breaks and widths come from Even's own font metrics (`pretext`); the glyph shapes
 * are ours, because Even's font ships inside its firmware and simulator.
 */
import { getTextWidth } from "@evenrealities/pretext";
import { useEffect, useRef } from "react";
import x from "./output.module.css";

export const G2 = { width: 576, height: 288, lineHeight: 27, maxLines: 10, textWidth: 552, inset: 12 } as const;
const SAMPLE = "The quick brown fox jumps over the lazy dog, 0123456789";
/** Cuts the edge blur of browser text down to the hard steps of a low-resolution panel. */
const levelOf = (v: number) => (v > 120 ? 1 : v > 70 ? 0.45 : 0);

/** Greedy word wrap on the firmware's own widths. */
export function g2Wrap(text: string): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (getTextWidth(next) <= G2.textWidth) line = next;
      else {
        if (line) lines.push(line);
        line = word;
      }
    }
    lines.push(line);
  }
  return lines;
}

function draw(canvas: HTMLCanvasElement, lines: string[]) {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, G2.width, G2.height);
  ctx.fillStyle = "#fff";
  ctx.textBaseline = "middle";
  const family = getComputedStyle(canvas).fontFamily;
  ctx.font = `500 20px ${family}`;
  // The size at which this font sets text as wide as Even's does, so lines need little correction.
  ctx.font = `500 ${(20 * getTextWidth(SAMPLE)) / ctx.measureText(SAMPLE).width}px ${family}`;
  lines.slice(0, G2.maxLines).forEach((line, i) => {
    // Spread each line to the width the glasses give it, so it ends where it would on the lens.
    const measured = ctx.measureText(line).width;
    ctx.letterSpacing = line.length > 1 ? `${(getTextWidth(line) - measured) / (line.length - 1)}px` : "0px";
    ctx.fillText(line, G2.inset, i * G2.lineHeight + G2.lineHeight / 2);
    ctx.letterSpacing = "0px";
  });
  const image = ctx.getImageData(0, 0, G2.width, G2.height);
  const { data } = image;
  for (let p = 0; p < data.length; p += 4) {
    const level = levelOf(data[p]);
    data[p] = 0;
    data[p + 1] = Math.round(level * 255);
    data[p + 2] = Math.round(level * 40);
  }
  ctx.putImageData(image, 0, 0);
}

export function G2Screen({ lines }: { lines: string[] }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const key = lines.join("\n");
  useEffect(() => {
    const node = canvas.current;
    if (!node) return;
    let live = true;
    const paint = () => {
      if (live) draw(node, key.split("\n"));
    };
    paint();
    void document.fonts?.ready.then(paint);
    return () => {
      live = false;
    };
  }, [key]);
  return <canvas ref={canvas} className={x.g2} width={G2.width} height={G2.height} role="img" aria-label={`G2 display: ${lines.join(" ")}`} />;
}
