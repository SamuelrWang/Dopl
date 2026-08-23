/**
 * THE OVERRIDE ALGEBRA. Two properties carry the whole design:
 *
 *  - **AN UNTOUCHED SHEET IS NOT AN OVERRIDE.** Opening the launch sheet and
 *    pressing Launch must put the SAME payload on the wire that clicking the row
 *    puts there. Otherwise two paths an operator reads as "launch this template"
 *    reach main as two different requests, and only one of them is covered.
 *  - **THE BOUNDS ARE `../schema.ts`'s NUMBERS**, so an override cannot be
 *    shaped in a way the durable row could never have held.
 */

import { describe, expect, it } from "vitest";
import type { AgentTemplate } from "../client/types";
import {
  MAX_OVERRIDE_FIELD_COUNT,
  MAX_OVERRIDE_KEY_CHARS,
  boundOverrideFields,
  overridesFor,
} from "./launch-overrides";

function template(over: Partial<AgentTemplate> = {}): AgentTemplate {
  return {
    id: "tpl-1",
    workspaceId: "ws-1",
    name: "Code auditor",
    description: null,
    instructions: "Be terse.",
    model: "claude-opus-5",
    fields: [{ key: "repo", value: "~/src/dopl" }],
    visibility: "private",
    teamIds: [],
    knowledgeBases: [],
    createdBy: "user-1",
    createdAt: "2026-08-01T00:00:00Z",
    updatedAt: "2026-08-01T00:00:00Z",
    ...over,
  };
}

describe("overridesFor", () => {
  it("answers undefined when the sheet changed nothing", () => {
    const t = template();
    expect(overridesFor(t, "", t.fields)).toBeUndefined();
  });

  it("treats picking the template's OWN model as no override", () => {
    const t = template();
    expect(overridesFor(t, "claude-opus-5", t.fields)).toBeUndefined();
  });

  it("carries a model the operator actually moved", () => {
    const t = template();
    expect(overridesFor(t, "claude-haiku-4-5-20251001", t.fields)).toEqual({
      model: "claude-haiku-4-5-20251001",
    });
  });

  it("carries fields as a REPLACEMENT set, never a merge", () => {
    const t = template({
      fields: [
        { key: "repo", value: "~/src/dopl" },
        { key: "severity", value: "high" },
      ],
    });
    expect(overridesFor(t, "", [{ key: "repo", value: "~/src/other" }])).toEqual({
      fields: [{ key: "repo", value: "~/src/other" }],
    });
  });

  it("does not report a field override for a value that only gained whitespace", () => {
    const t = template();
    expect(overridesFor(t, "", [{ key: " repo ", value: " ~/src/dopl " }])).toBeUndefined();
  });
});

describe("boundOverrideFields", () => {
  it("drops an empty key rather than refusing the launch", () => {
    expect(
      boundOverrideFields([
        { key: "", value: "orphan" },
        { key: "repo", value: "x" },
      ])
    ).toEqual([{ key: "repo", value: "x" }]);
  });

  it("keeps an empty VALUE — a key with no value is a legal half-filled form", () => {
    expect(boundOverrideFields([{ key: "repo", value: "" }])).toEqual([
      { key: "repo", value: "" },
    ]);
  });

  it("drops a duplicate key, keeping the first", () => {
    expect(
      boundOverrideFields([
        { key: "repo", value: "first" },
        { key: "repo", value: "second" },
      ])
    ).toEqual([{ key: "repo", value: "first" }]);
  });

  it("caps the key at the schema's own length", () => {
    const [only] = boundOverrideFields([{ key: "k".repeat(500), value: "v" }]);
    expect(only.key.length).toBe(MAX_OVERRIDE_KEY_CHARS);
  });

  it("caps the count at the schema's own rail", () => {
    const many = Array.from({ length: 80 }, (_, i) => ({
      key: `k${i}`,
      value: "v",
    }));
    expect(boundOverrideFields(many).length).toBe(MAX_OVERRIDE_FIELD_COUNT);
  });

  it("drops from the END rather than truncating a value past the byte cap", () => {
    const fat = Array.from({ length: 20 }, (_, i) => ({
      key: `k${i}`,
      value: "v".repeat(900),
    }));
    const bounded = boundOverrideFields(fat);
    expect(bounded.length).toBeLessThan(fat.length);
    // Every surviving value is INTACT — a silently clipped value is a lie about
    // what the agent was handed.
    for (const field of bounded) expect(field.value.length).toBe(900);
  });
});
