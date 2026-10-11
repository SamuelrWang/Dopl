/**
 * FIELD KEYS AGREE ACROSS THE PACKAGE BOUNDARY. The app keys a named field with
 * `src/features/ontology/field-kinds.ts › fieldKey`; this package cannot import `src/` at runtime
 * (tsconfig `rootDir: "src"`), so `ontology-ops-write.ts` hand-mirrors the rule at its two key
 * sites (set_attribute, set_template_field). A field created over MCP and the same field created
 * in the panel must land at ONE key, or an attribute stops matching its type's template field.
 * Tests are outside the build, so this file imports the app's rule directly and pins both sites
 * to it with labels that exercise every part (case, surrounding space, a run of spaces).
 */

import { describe, expect, it, vi } from "vitest";
import type { DoplClient, OntologyObject, OntologySnapshot } from "@dopl/client";
import { fieldKey } from "../../../../src/features/ontology/field-kinds";
import { dispatch } from "./ontology-ops-write";

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

function setup() {
  const snapshot: OntologySnapshot = {
    ontologies: [{ id: "o-1", slug: "crm", name: "CRM", purpose: "", columnIds: [LANE] }],
    objects: {
      [LANE]: obj(LANE, "Lead", { childIds: [CARD] }),
      [CARD]: obj(CARD, "Acme"),
    },
  };
  const update = vi.fn(async (id: string, patch: Partial<OntologyObject>) => ({
    ...snapshot.objects[id],
    ...patch,
  }));
  const client = {
    getOntology: vi.fn(async () => snapshot),
    updateOntologyObject: update,
  } as unknown as DoplClient;
  return { client, update };
}

const LABELS = ["Next Step", "  Due   Date ", "Owner"];

describe("MCP field keys equal the app's fieldKey", () => {
  for (const label of LABELS) {
    it(`set_attribute ${JSON.stringify(label)}`, async () => {
      const { client, update } = setup();
      await dispatch(client, { op: "set_attribute", object: CARD, label, value: "x" });
      expect(update).toHaveBeenCalledTimes(1);
      const attrs = (update.mock.calls[0][1] as Partial<OntologyObject>).attributes ?? [];
      expect(attrs.map((a) => a.key)).toEqual([fieldKey(label)]);
    });

    it(`set_template_field ${JSON.stringify(label)}`, async () => {
      const { client, update } = setup();
      await dispatch(client, { op: "set_template_field", object: LANE, label });
      expect(update).toHaveBeenCalledTimes(1);
      const template = (update.mock.calls[0][1] as Partial<OntologyObject>).template ?? [];
      expect(template.map((f) => f.key)).toEqual([fieldKey(label)]);
    });
  }
});
