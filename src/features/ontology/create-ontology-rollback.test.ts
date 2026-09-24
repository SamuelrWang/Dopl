/**
 * Unit — createOntology partial-failure rollback decision (F-031). Ontology POST
 * fires first, so a later failure leaves an orphan ontology to undo; a
 * first-POST failure created nothing.
 */

import { describe, it, expect } from "vitest";
import { planOntologyCreateRollback } from "./create-ontology-rollback";

describe("planOntologyCreateRollback", () => {
  it("rolls back the orphan ontology when the ontology POST succeeded", () => {
    expect(planOntologyCreateRollback("ontology-123")).toEqual({
      rollback: true,
      ontologyId: "ontology-123",
    });
  });

  it("does nothing when the ontology POST itself failed", () => {
    expect(planOntologyCreateRollback(null)).toEqual({ rollback: false });
  });
});
