/**
 * Landing line-icons: decorative (aria-hidden), tinted by `currentColor`,
 * sized by `size` with per-icon defaults the nav/hero rely on.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { ArrowUpRight, MenuIcon, SearchIcon, SpeakerIcon, SpeakerMutedIcon } from "./icons";

function svg(markup: string): string {
  const m = markup.match(/^<svg[^>]*>/);
  if (!m) throw new Error(`no <svg> root in: ${markup}`);
  return m[0];
}

const STROKED = [
  { name: "ArrowUpRight", Icon: ArrowUpRight, size: 18, marks: 2 },
  { name: "SearchIcon", Icon: SearchIcon, size: 20, marks: 2 },
  { name: "SpeakerIcon", Icon: SpeakerIcon, size: 20, marks: 3 },
  { name: "SpeakerMutedIcon", Icon: SpeakerMutedIcon, size: 20, marks: 3 },
] as const;

describe.each(STROKED)("$name", ({ Icon, size, marks }) => {
  it("is a hidden, currentColor-stroked 24-grid icon with its default size", () => {
    const markup = renderToStaticMarkup(<Icon />);
    const root = svg(markup);
    for (const attr of [
      `width="${size}"`,
      `height="${size}"`,
      'viewBox="0 0 24 24"',
      'fill="none"',
      'stroke="currentColor"',
      'stroke-width="2"',
      'stroke-linecap="round"',
      'stroke-linejoin="round"',
      'aria-hidden="true"',
    ]) {
      expect(root).toContain(attr);
    }
    expect(markup.match(/<(path|circle)\b/g)).toHaveLength(marks);
  });

  it("honours an explicit size", () => {
    const root = svg(renderToStaticMarkup(<Icon size={13} />));
    expect(root).toContain('width="13"');
    expect(root).toContain('height="13"');
  });
});

describe("MenuIcon", () => {
  it("is two filled bars, unstroked, hidden, default 20", () => {
    const markup = renderToStaticMarkup(<MenuIcon />);
    const root = svg(markup);
    expect(root).toContain('width="20"');
    expect(root).toContain('aria-hidden="true"');
    expect(root).not.toContain("stroke");
    expect(markup.match(/<rect\b[^>]*fill="currentColor"/g)).toHaveLength(2);
  });
});
