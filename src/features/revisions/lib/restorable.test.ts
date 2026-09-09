/**
 * WHAT MAY BE WRITTEN BACK — the predicate the RESTORE BUTTON and the SERVER'S
 * REFUSAL both read (2026-09-09, part 2).
 *
 * ⚠ **THE POINT OF THE SUITE IS THAT THERE IS ONE ANSWER.** Two statements of
 * "restorable" is how a control that can only fail gets drawn, which is the
 * failure `components/changelog-list.tsx` and
 * `server/service.ts › restoreRevision` are both written against.
 *
 * ⚠ MUTATION-VERIFIED — three reverts, three failures: admitting an ontology
 * ASSOCIATION row; admitting a `create`/`delete` BUNDLE (which has no `before`);
 * and admitting an `ontology_cluster` field row, for which no restore route
 * exists.
 */

import { describe, it, expect } from "vitest";
import type { Revision, RevisionResourceType } from "../types";
import { isRestorable } from "./restorable";

function rev(
  resourceType: RevisionResourceType,
  payload: Revision["payload"]
): Revision {
  return {
    id: "r-1",
    resourceType,
    resourceId: "x-1",
    workspaceId: "ws-1",
    actor: { userId: "u-1", kind: "user", agentSessionId: null },
    op: "edit",
    summary: null,
    payload,
    contentHash: "h",
    createdAt: "2026-09-09T00:00:00.000Z",
    updatedAt: "2026-09-09T00:00:00.000Z",
  };
}

describe("knowledge", () => {
  it("a snapshot with a body is restorable; one without is not", () => {
    expect(isRestorable(rev("knowledge_entry", { body: "hello" }))).toBe(true);
    expect(isRestorable(rev("knowledge_entry", { body: "" }))).toBe(true);
    expect(isRestorable(rev("knowledge_folder", { title: "Notes" }))).toBe(false);
    expect(isRestorable(rev("knowledge_base", { title: "KB" }))).toBe(false);
  });
});

describe("ontology", () => {
  it("a FIELD row on an object is restorable", () => {
    expect(
      isRestorable(rev("ontology_object", { field: "name", before: "A", after: "B" }))
    ).toBe(true);
  });

  it("🔒 an ASSOCIATION row is not — restoring an edge re-points at a far end that may be gone", () => {
    expect(
      isRestorable(
        rev("ontology_object", {
          association: "relationship",
          field: "relationship",
          before: [],
          after: [{ label: "works at", targetIds: ["o-2"] }],
        })
      )
    ).toBe(false);
  });

  it("a create/delete BUNDLE is not — it carries fields, never a `before`", () => {
    expect(
      isRestorable(rev("ontology_object", { fields: { name: "Acme" } }))
    ).toBe(false);
  });

  it("🔒 a CLUSTER row is not — the only restore door addresses an OBJECT", () => {
    expect(
      isRestorable(
        rev("ontology_cluster", { field: "name", before: "Sales", after: "Pipeline" })
      )
    ).toBe(false);
  });
});
