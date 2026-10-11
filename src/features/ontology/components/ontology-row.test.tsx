// @vitest-environment jsdom
/**
 * The field NAME wears a gray rectangular badge in the Rows display (Samuel
 * #3031, Rows view #3079, gray not black #3162/#3186). First coverage this
 * component has had.
 *
 * What is pinned is the TOKEN, not a colour: `bg-text-secondary` /
 * `text-text-on-invert`, so a brand change moves the badge with it and a literal
 * hex would not. A test on "looks gray" would pass against a minted `#555`,
 * which is the thing the brief forbade.
 *
 * Four things here are easy to break and silent when broken:
 * - RECTANGLE, not a lozenge. `rounded-[4px]`, never `rounded-pill`.
 * - EDGES ARE NOT FIELDS. Relationship labels share this `<dt>` and must stay
 *   italic and unbadged — he asked for field names.
 * - The ellipsis belongs INSIDE the badge. `truncate` on the `<dt>` would clip an
 *   inline-block child square instead of ellipsing it, so the badge owns it.
 * - THE TOKEN MUST ACTUALLY EXIST. A class-string assertion cannot tell
 *   present-and-correct from absent-entirely: name a token that was renamed or
 *   never defined and Tailwind emits no rule, the badge renders UNPAINTED, and
 *   every assertion above still passes. The last test closes that by reading
 *   `globals.css` and making absence THROW.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { GraphState } from "../graph-state";
import type { OntologyObject } from "../types";
import { OntologyRow } from "./ontology-row";

afterEach(cleanup);

const OBJECT: OntologyObject = {
  id: "o1",
  name: "Acme Corp",
  subtitle: "A lead",
  attributes: [
    { key: "stage", label: "Stage", value: { kind: "text", value: "Qualified" } },
    // A long one: the pill has to truncate without widening the column.
    {
      key: "owner",
      label: "Account owner of record",
      value: { kind: "text", value: "Sam" },
    },
  ],
  relationships: [{ label: "member of", targetIds: ["o2"] }],
  methods: [],
  childIds: [],
  template: [],
} as OntologyObject;

const GRAPH: GraphState = {
  ontologies: [],
  objects: {
    o1: OBJECT,
    o2: { ...OBJECT, id: "o2", name: "Pipeline", attributes: [], relationships: [] },
  },
} as unknown as GraphState;

const renderRow = () =>
  render(
    <OntologyRow objectId="o1" graph={GRAPH} selected={false} onSelect={vi.fn()} />
  );

/** The same object with one attribute whose `label` is blank — a valid write, since
 *  `ontology/schema.ts` types it `z.string().max(200)` with no `.min(1)`. */
const renderRowWithBlankLabel = (label: string) => {
  const graph = {
    ...GRAPH,
    objects: {
      ...GRAPH.objects,
      o1: {
        ...OBJECT,
        attributes: [{ key: "stage", label, value: { kind: "text", value: "Qualified" } }],
        relationships: [],
      },
    },
  } as unknown as GraphState;
  return render(
    <OntologyRow objectId="o1" graph={graph} selected={false} onSelect={vi.fn()} />
  );
};

describe("a blank field name paints nothing, not a nub", () => {
  // ⚠ `label` is `z.string().max(200)` in `ontology/schema.ts` — no `.min(1)` — so
  // `label: ""` is a VALID write. As plain text it was invisible; as a filled badge
  // it became a ~6px dark-gray rectangle of padding around nothing, which reads as
  // a rendering fault rather than as missing data.
  it.each(["", "   "])("draws no badge for label %o", (label) => {
    const { container } = renderRowWithBlankLabel(label);
    // The value still renders — this is about the NAME, and a row that vanished
    // entirely would also pass a "no badge" assertion.
    expect(screen.getByText("Qualified")).toBeTruthy();
    expect(container.querySelector(".bg-text-secondary")).toBeNull();
  });

  it("🔒 still draws the badge when the label has content — the control", () => {
    // Without this, deleting the badge outright would pass the two cases above.
    const { container } = renderRowWithBlankLabel("Stage");
    expect(container.querySelector(".bg-text-secondary")).not.toBeNull();
  });
});

describe("the field name wears a black pill in Rows", () => {
  it("draws the label on the published gray token, not a hex", () => {
    renderRow();
    const label = screen.getByText("Stage");
    expect(label.className).toContain("bg-text-secondary");
    expect(label.className).toContain("text-text-on-invert");
    // A minted colour would pass a "looks gray" assertion. This cannot.
    expect(label.className).not.toMatch(/\[#|bg-black|text-white|bg-gray-/);
  });

  it("is MID gray — not either darker fill he already rejected", () => {
    renderRow();
    // Both were shipped and both came back as "reads black" (#3162, #3186).
    // Pinned by name: they are a shade apart on screen, so a revert to either
    // would look "still fine" in review while undoing what he asked for twice.
    const cls = screen.getByText("Stage").className;
    expect(cls).not.toContain("surface-cta"); // #1c2127, 16.20:1
    expect(cls).not.toContain("home-frame"); // #2f3542, 12.29:1
  });

  it("is a RECTANGLE with a small radius, never a lozenge", () => {
    renderRow();
    const label = screen.getByText("Stage");
    expect(label.className).toContain("rounded-[4px]");
    expect(label.className).not.toMatch(/rounded-(pill|full)/);
  });

  it("leaves relationship labels alone — edges are not fields", () => {
    renderRow();
    const edge = screen.getByText("member of");
    expect(edge.className).toContain("italic");
    expect(edge.className).not.toContain("bg-surface-cta");
  });

  it("truncates INSIDE the pill, so a long name cannot widen the column", () => {
    renderRow();
    const label = screen.getByText("Account owner of record");
    expect(label.className).toContain("truncate");
    expect(label.className).toContain("max-w-full");
    // The <dt> must NOT also truncate: it would clip the pill square.
    const dt = label.closest("dt");
    expect(dt).not.toBeNull();
    expect(dt?.className).toContain("w-40");
    expect(dt?.className).not.toContain("truncate");
  });

  it("does not touch the value", () => {
    renderRow();
    const value = screen.getByText("Qualified");
    expect(value.className).not.toContain("bg-text-secondary");
    expect(value.textContent).toBe("Qualified");
  });

  /**
   * The guard the other tests cannot be: they asserted a STRING. This asserts the
   * token behind it is declared, so a rename or typo fails here instead of
   * shipping an unpainted badge under a green suite.
   *
   * Reads the SOURCE css, not a build artifact — no build has to have run, and
   * there is nothing stale to match against. Every lookup throws on absence
   * rather than measuring zero, including the file read itself.
   */
  it("uses only colour tokens that globals.css actually declares", () => {
    // Project-root relative, NOT `import.meta.url`: under the jsdom environment
    // that is not a file: URL and `fileURLToPath` throws on it.
    const cssPath = resolve(process.cwd(), "src/app/globals.css");
    const css = readFileSync(cssPath, "utf8"); // throws if the path ever moves
    expect(css.length).toBeGreaterThan(1000);

    renderRow();
    const classes = screen.getByText("Stage").className.split(/\s+/);
    const colourUtilities = classes.filter((c) => /^(bg|text)-/.test(c));
    // Guard the guard: if the badge stops carrying colour utilities, this test
    // must fail rather than vacuously pass over an empty list.
    expect(colourUtilities).toContain("bg-text-secondary");

    for (const utility of colourUtilities) {
      const token = utility.replace(/^(bg|text)-/, "");
      // `text-caption` and `font-*` are type scale, not colour — skipped by
      // looking for the --color-* declaration and only asserting when the
      // utility is a colour one (every colour utility here maps 1:1).
      if (/^(caption|micro|body|lead|label)$/.test(token)) continue;
      expect(
        css.includes(`--color-${token}:`),
        `${utility} has no --color-${token} in globals.css, so Tailwind emits no rule and the badge renders unpainted`
      ).toBe(true);
    }
  });
});
