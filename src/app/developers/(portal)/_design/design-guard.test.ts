/** Overhauled pages use the shared components only, so they cannot drift from the Playground. See README.md. */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SECTIONS = join(__dirname, "..", "_sections");
const OVERHAULED = /^(users|devices|keys|add-device|playground|team|usage|webhooks|connect|activity|integration|receives|issues|overview)[-.a-z]*\.tsx$/;
const files = readdirSync(SECTIONS).filter((f) => OVERHAULED.test(f));

describe("overhauled pages", () => {
  it("finds them", () => {
    expect(files.length).toBeGreaterThanOrEqual(10);
  });

  it.each(files)("%s imports no design CSS", (file) => {
    expect(readFileSync(join(SECTIONS, file), "utf8")).not.toMatch(/\.module\.css/);
  });

  it.each(["portal-shell.tsx", "find-anything.tsx"])("the sidebar's %s imports no design CSS", (file) => {
    expect(readFileSync(join(__dirname, "..", "_components", file), "utf8")).not.toMatch(/_design\/[a-z-]+\.module\.css/);
  });

  const DOCS = join(__dirname, "..", "..", "..", "..", "features", "marketing", "docs", "components");
  // docs-page.tsx keeps its CSS until the docs restyle is committed; drop this filter when it lands.
  it.each(readdirSync(DOCS).filter((f) => f !== "docs-page.tsx"))("the docs site's %s imports no CSS", (file) => {
    expect(readFileSync(join(DOCS, file), "utf8")).not.toMatch(/\.css"/);
  });

  it("never import sample data", () => {
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : /\.tsx?$/.test(e.name) ? [join(dir, e.name)] : []));
    const here = (name: string) => join(__dirname, "..", name);
    for (const f of [...walk(here("_sections")), ...walk(here("_components")), ...walk(here("_lib"))]) {
      expect(readFileSync(f, "utf8"), f).not.toMatch(/_data\/|DEMO_NOW|larkfield/i);
    }
    expect(existsSync(here("_data"))).toBe(false);
  });

  it("have no CSS modules of their own", () => {
    expect(readdirSync(SECTIONS).filter((f) => f.endsWith(".module.css"))).toEqual([]);
  });
});
