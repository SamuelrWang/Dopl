// @vitest-environment jsdom
/**
 * The `/devices` landing: the hero headline renders verbatim, both CTAs point where the outline
 * says ("Get a key" to the portal's keys, "Read the docs" to /docs), and no rendered copy carries
 * an em or en dash or a BUILT/ROADMAP tag.
 */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import DevicesPage from "@/app/devices/page";
import { HERO } from "./content";

afterEach(cleanup);

describe("/devices landing", () => {
  it("renders the hero headline", () => {
    render(<DevicesPage />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(HERO.heading);
  });

  it("links both CTAs, in the hero and in the closing panel", () => {
    render(<DevicesPage />);
    const keys = screen.getAllByRole("link", { name: /Get a key/ });
    const docs = screen.getAllByRole("link", { name: /Read the docs/ });
    expect(keys).toHaveLength(2);
    expect(docs).toHaveLength(2);
    for (const a of keys) expect(a.getAttribute("href")).toBe("/developers/keys");
    for (const a of docs) expect(a.getAttribute("href")).toBe("/docs");
  });

  it("keeps the outline's copy rules", () => {
    const { container } = render(<DevicesPage />);
    const main = container.querySelector("main")?.textContent ?? "";
    expect(main).not.toMatch(/[–—]/);
    expect(main).not.toMatch(/\b(BUILT|ROADMAP)\b/);
  });
});
