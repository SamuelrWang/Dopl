/**
 * Ontology FIELDS over MCP (2026-10-01): the underscore regression, field
 * descriptions (the object TYPE's only), and the three typed kinds — enum
 * (closed set), date, link.
 */

import { describe, expect, it, vi } from "vitest";
import type { DoplClient, OntologyObject, OntologySnapshot } from "@dopl/client";
import { dispatch } from "./ontology-ops-write";
import { renderObject } from "./ontology-render";
import { neutralizeInline } from "./narration";

const LANE = "11111111-1111-4111-8111-111111111111";
const CARD = "22222222-2222-4222-8222-222222222222";

function obj(id: string, name: string, extra: Partial<OntologyObject> = {}): OntologyObject {
  return {
    id,
    name,
    subtitle: "",
    attributes: [],
    methods: [],
    relationships: [],
    childIds: [],
    template: [],
    updatedAt: "2026-10-01T00:00:00Z",
    ...extra,
  };
}

function setup(lane: Partial<OntologyObject> = {}, card: Partial<OntologyObject> = {}) {
  const snapshot: OntologySnapshot = {
    ontologies: [{ id: "o-1", slug: "crm", name: "CRM", purpose: "", columnIds: [LANE] }],
    objects: {
      [LANE]: obj(LANE, "Lead", { childIds: [CARD], ...lane }),
      [CARD]: obj(CARD, "Acme", card),
    },
  };
  const update = vi.fn(async (id: string, patch: Partial<OntologyObject>) => ({
    ...snapshot.objects[id],
    ...patch,
  }));
  const client = {
    getOntology: vi.fn(async () => snapshot),
    updateOntologyObject: update,
    createOntologyObject: vi.fn(async (input: { name: string }) => obj("new-id", input.name)),
  } as unknown as DoplClient;
  return { client, update, snapshot };
}

const text = (r: { content: Array<{ text: string }> }) => r.content.map((c) => c.text).join("\n");

describe("REGRESSION: names keep their underscores", () => {
  it("neutralizeInline leaves `_` alone (it stripped it, mangling identifiers)", () => {
    expect(neutralizeInline("glitch08_")).toBe("`glitch08_`");
    expect(neutralizeInline("jeremyp_32711")).toBe("`jeremyp_32711`");
    // the structural set is still stripped
    expect(neutralizeInline("a`b#c")).toBe("`a b c`");
  });

  it("create_object reports the name exactly as given", async () => {
    const { client } = setup();
    for (const name of ["glitch08_", "jeremyp_32711"]) {
      const out = text(await dispatch(client, { op: "create_object", parent: LANE, name }));
      expect(out).toContain(`Created \`${name}\``);
    }
  });

  it("get renders the stored name verbatim", () => {
    const { snapshot } = setup({}, { name: "jeremyp_32711" });
    snapshot.objects[CARD].name = "jeremyp_32711";
    expect(renderObject(snapshot.objects[CARD], snapshot)).toContain("# `jeremyp_32711`");
  });
});

describe("set_template_field — description, options, and an omitted kind kept", () => {
  it("writes a select field with its options and description", async () => {
    const { client, update } = setup();
    const out = text(
      await dispatch(client, {
        op: "set_template_field",
        object: LANE,
        label: "Company",
        kind: "enum",
        options: ["Even Realities", " Real Kids ", "even realities"],
        description: "Who the lead works for",
      }),
    );
    expect(out).toContain("(enum: `Even Realities`, `Real Kids`)");
    expect(update.mock.calls[0][1]).toEqual({
      template: [
        {
          key: "company",
          label: "Company",
          kind: "enum",
          description: "Who the lead works for",
          options: ["Even Realities", "Real Kids"],
        },
      ],
    });
  });

  it("a description-only call keeps the field's kind and options", async () => {
    const field = { key: "company", label: "Company", kind: "enum" as const, options: ["A", "B"] };
    const { client, update } = setup({ template: [field] });
    await dispatch(client, { op: "set_template_field", object: LANE, label: "Company", description: "x" });
    expect(update.mock.calls[0][1]).toEqual({ template: [{ ...field, description: "x" }] });
  });

  it("refuses options on a non-enum kind", async () => {
    const { client, update } = setup();
    const r = await dispatch(client, { op: "set_template_field", object: LANE, label: "Due", kind: "date", options: ["x"] });
    expect(r.isError).toBe(true);
    expect(update).not.toHaveBeenCalled();
  });
});

describe("set_attribute — the typed kinds", () => {
  const company = { key: "company", label: "Company", kind: "enum" as const, options: ["Even Realities", "Real Kids"] };

  it("an enum value comes from the TYPE's options, matched case-insensitively", async () => {
    const { client, update } = setup(
      { template: [company] },
      { attributes: [{ key: "company", label: "Company", value: { kind: "enum", value: "" } }] },
    );
    // no kind sent: the stored kind is kept
    await dispatch(client, { op: "set_attribute", object: CARD, label: "Company", value: "real kids" });
    expect(update.mock.calls[0][1]).toEqual({
      attributes: [
        {
          key: "company",
          label: "Company",
          value: { kind: "enum", value: "Real Kids" },
          options: ["Even Realities", "Real Kids"],
        },
      ],
    });
  });

  it("refuses a value outside the options, and names them", async () => {
    const { client, update } = setup({ template: [company] });
    const r = await dispatch(client, { op: "set_attribute", object: CARD, label: "Company", kind: "enum", value: "Acme" });
    expect(r.isError).toBe(true);
    expect(text(r)).toContain("`Even Realities`, `Real Kids`");
    expect(update).not.toHaveBeenCalled();
  });

  it("a date is YYYY-MM-DD (a timestamp keeps its day); anything else is refused", async () => {
    const { client, update } = setup();
    await dispatch(client, { op: "set_attribute", object: CARD, label: "Due", kind: "date", value: "2026-10-01T15:00:00Z" });
    expect(update.mock.calls[0][1].attributes[0].value).toEqual({ kind: "date", value: "2026-10-01" });
    for (const bad of ["10/01/2026", "2026-02-30"]) {
      const r = await dispatch(client, { op: "set_attribute", object: CARD, label: "Due", kind: "date", value: bad });
      expect(r.isError, bad).toBe(true);
    }
  });

  it("a link must be http(s)", async () => {
    const { client, update } = setup();
    await dispatch(client, { op: "set_attribute", object: CARD, label: "Site", kind: "link", value: "https://evenrealities.com/g2" });
    expect(update.mock.calls[0][1].attributes[0].value).toEqual({ kind: "link", value: "https://evenrealities.com/g2" });
    for (const bad of ["evenrealities.com", "javascript:alert(1)", "ftp://x.com"]) {
      const r = await dispatch(client, { op: "set_attribute", object: CARD, label: "Site", kind: "link", value: bad });
      expect(r.isError, bad).toBe(true);
    }
  });

});

// ⚠ ONE FIELD, ONE DESCRIPTION (Samuel, 2026-10-01): the object TYPE's.
describe("set_attribute — a description is the type's, never the card's", () => {
  it("refuses `description`, naming set_template_field on the card's type", async () => {
    const { client, update } = setup();
    const r = await dispatch(client, {
      op: "set_attribute",
      object: CARD,
      label: "Note",
      value: "a",
      description: "why",
    });
    expect(r.isError).toBe(true);
    expect(text(r)).toContain("set_template_field on `Lead`");
    expect(update).not.toHaveBeenCalled();
  });

  it("a stray per-card description is dropped on the next write", async () => {
    const { client, update } = setup(
      {},
      {
        attributes: [
          {
            key: "note",
            label: "Note",
            value: { kind: "text", value: "a" },
            ...({ description: "why" } as object),
          },
        ],
      },
    );
    await dispatch(client, { op: "set_attribute", object: CARD, label: "Note", value: "b" });
    expect(update.mock.calls[0][1].attributes[0]).toEqual({
      key: "note",
      label: "Note",
      value: { kind: "text", value: "b" },
    });
  });
});

describe("get — kinds, options and descriptions reach the agent", () => {
  it("renders them on attribute and template lines", () => {
    const { snapshot } = setup(
      { template: [{ key: "company", label: "Company", kind: "enum", options: ["A", "B"], description: "Employer" }] },
      {
        attributes: [
          { key: "company", label: "Company", value: { kind: "enum", value: "A" }, options: ["A", "B"] },
          { key: "due", label: "Due", value: { kind: "date", value: "2026-10-01" } },
          {
            key: "site",
            label: "Site",
            value: { kind: "link", value: "https://x.com/a_b#c" },
            // a stray per-card copy — never read (the type has no Site field)
            ...({ description: "Card copy" } as object),
          },
        ],
      },
    );
    const card = renderObject(snapshot.objects[CARD], snapshot);
    // the card's field reads the TYPE's description
    expect(card).toContain("- `Company` (enum: `A`, `B`): `A`\n  Description: Employer");
    expect(card).toContain("- `Due` (date): `2026-10-01`");
    // the URL survives whole — `_` and `#` included
    expect(card).toContain("- `Site` (link): `https://x.com/a_b#c`");
    expect(card).not.toContain("Card copy");
    const lane = renderObject(snapshot.objects[LANE], snapshot);
    expect(lane).toContain("- `Company` (enum: `A`, `B`)\n  Description: Employer");
  });
});
