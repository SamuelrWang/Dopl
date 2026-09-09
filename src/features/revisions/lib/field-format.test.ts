/**
 * THE ONTOLOGY ROW'S THREE STRINGS (2026-09-09, part 2).
 *
 * ⚠ **THE TWO FAILURES THIS CATCHES ARE OPPOSITE ONES**: a value rendered as
 * `[object Object]` (or a JSON blob cut mid-token), and a value rendered as an
 * empty string — the second is worse, because `Stage:  → Won` reads as a broken
 * component rather than as an absent value.
 *
 * ⚠ MUTATION-VERIFIED — three reverts, three failures: unwrapping an attribute
 * union's `{kind, value}` (the row renders the schema fact instead of the
 * value); dropping the `attribute:` prefix strip (every property row is labelled
 * `Attribute:stage`); and returning `""` instead of {@link NO_VALUE} for an
 * absent half.
 */

import { describe, it, expect } from "vitest";
import type { Revision } from "../types";
import { bundleOf, fieldLabel, fieldLineOf, formatValue, NO_VALUE } from "./field-format";

function rev(payload: Revision["payload"]): Revision {
  return {
    id: "r-1",
    resourceType: "ontology_object",
    resourceId: "o-1",
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

describe("fieldLabel", () => {
  it("strips the attribute prefix and spells a column in words", () => {
    expect(fieldLabel("attribute:stage")).toBe("Stage");
    expect(fieldLabel("subtitle")).toBe("Subtitle");
    expect(fieldLabel("agentsMayEdit")).toBe("Agents may edit");
  });

  it("drops the channel id from a share label — it names a room the reader may not be in", () => {
    expect(fieldLabel("share:ch-9")).toBe("Sharing");
  });
});

describe("formatValue", () => {
  it("unwraps an attribute union to the value a person changed", () => {
    expect(formatValue({ kind: "pill", value: "Won" })).toBe("Won");
    expect(formatValue({ kind: "ref", value: ["a", "b"] })).toBe("a, b");
  });

  it("counts a list of objects rather than serializing it", () => {
    expect(formatValue([{ name: "Email" }, { name: "Call" }])).toBe("2 items");
  });

  it("an absent, empty or missing value is one glyph, never an empty string", () => {
    expect(formatValue(null)).toBe(NO_VALUE);
    expect(formatValue(undefined)).toBe(NO_VALUE);
    expect(formatValue("")).toBe(NO_VALUE);
    expect(formatValue([])).toBe(NO_VALUE);
  });

  it("renders a booleans as words and a share record as its levels", () => {
    expect(formatValue(true)).toBe("Yes");
    expect(formatValue({ membersLevel: "view", guestsLevel: "none" })).toBe(
      "Guests level none, Members level view"
    );
  });
});

describe("fieldLineOf", () => {
  it("answers the line for a field row and marks an association", () => {
    expect(
      fieldLineOf(
        rev({ field: "attribute:stage", before: { kind: "pill", value: "New" }, after: { kind: "pill", value: "Won" } })
      )
    ).toEqual({ label: "Stage", before: "New", after: "Won", association: false });
    expect(
      fieldLineOf(rev({ association: "membership", field: "membership", before: null, after: {} }))
        ?.association
    ).toBe(true);
  });

  it("answers null for a BUNDLE row — it has no field to name", () => {
    expect(fieldLineOf(rev({ fields: { name: "Acme" } }))).toBeNull();
  });
});

describe("bundleOf", () => {
  it("answers the create/delete fields in a stable order, and nothing for other rows", () => {
    expect(bundleOf(rev({ fields: { subtitle: "", name: "Acme" } }))).toEqual([
      { label: "Name", value: "Acme" },
      { label: "Subtitle", value: NO_VALUE },
    ]);
    expect(bundleOf(rev({ field: "name", before: "a", after: "b" }))).toEqual([]);
  });
});
