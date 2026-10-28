import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Source pins: jsdom loads no stylesheet, so the column heights can only be read as a statement.
const read = (file: string) => readFileSync(new URL(file, import.meta.url), "utf8");
const css = read("./overview.module.css");
const rule = (selector: string) => {
  const start = css.indexOf(`\n${selector} {`);
  expect(start, selector).toBeGreaterThan(-1);
  return css.slice(start, css.indexOf("}", start));
};

describe("the Overview's two columns end on one line (Samuel's ruling)", () => {
  it("gives the grid one height and the slotted cards fixed ones", () => {
    expect(rule(".grid")).toContain("height: var(--ove-cols-h)");
    expect(rule(".slotNeeds")).toContain("height: var(--ove-needs-h)");
    expect(rule(".slotCredits")).toContain("height: var(--ove-credits-h)");
    expect(rule(".pair")).toContain("height: var(--ove-pair-h)");
  });

  it("lets the last card in a column take the rest, and the body scroll under its title", () => {
    expect(rule(".col > .card:last-child")).toContain("flex: 1 1 0%");
    expect(rule(".col > .card")).toContain("flex: none");
    expect(rule(".body")).toContain("overflow-y: auto");
  });

  it("slots the first card of each column", () => {
    const face = read("./overview-needs.tsx") + read("./overview-credits.tsx");
    expect(face).toContain("className={styles.slotNeeds}");
    expect(face).toContain("className={styles.slotCredits}");
  });
});

describe("the Overview's cards", () => {
  it("wear the kit's white card, which reads `--shadow-bento`", () => {
    expect(read("./overview-card.tsx")).toContain('cn("white-card", styles.card, className)');
    expect(read("./overview-summary.tsx")).toContain('cn("white-card", styles.card, styles.strip)');
    expect(readFileSync(new URL("../../../../app/globals.css", import.meta.url), "utf8")).toMatch(
      /\.white-card \{[^}]*box-shadow: var\(--shadow-bento\);/
    );
  });
});
