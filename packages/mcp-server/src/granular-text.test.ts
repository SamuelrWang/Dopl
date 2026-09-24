/**
 * The granular tools' text (`granular-text.ts`): every tool and param said once and only for a param
 * the tool has, and the served strings in the house style — short, first sentence inside the headline
 * window, no legacy call spellings, the fence stated once in the instructions. The retired graph word is
 * `src/features/ontology/vocabulary.test.ts`'s, repo-wide, these files included.
 */

import { describe, expect, it } from "vitest";

import { FENCE_POINTER, GRANULAR_TEXT, SHARED_PARAMS } from "./granular-text.js";
import { INSTRUCTIONS_MAX_CHARS } from "./instructions.js";
import { boot } from "./surface-sweep.js";
import { GRANULAR_TOOLS, GRANULAR_TOOL_NAMES, selectorOf, type ToolSet } from "./tool-manifest.js";
import { FENCE_DESCRIPTION_NOTE } from "./tools/untrusted-fence.js";
import { HEADLINE_MAX_CHARS, READ_DESCRIPTION_MAX_CHARS } from "./tools/tool-style.js";

async function served(toolSet: ToolSet) {
  const { client } = await boot(toolSet);
  return { tools: (await client.listTools()).tools, instructions: client.getInstructions() ?? "" };
}

describe("the text covers the manifest exactly", () => {
  it("one entry per granular tool", () => {
    expect(Object.keys(GRANULAR_TEXT).sort()).toEqual([...GRANULAR_TOOL_NAMES].sort());
  });

  it.each(GRANULAR_TOOLS.map((t) => [t.name, t] as const))("%s says only what it has", (name, t) => {
    const text = GRANULAR_TEXT[name];
    const own = [...t.params, ...(t.carry ?? [])];
    const has = new Set([...own, selectorOf(t), "container"]);
    expect(Object.keys(text.params ?? {}).filter((p) => !has.has(p)), "described but absent").toEqual([]);
    expect((text.required ?? []).filter((p) => !own.includes(p)), "required but absent").toEqual([]);
    expect(Object.keys(text.types ?? {}).filter((p) => !own.includes(p)), "typed but absent").toEqual([]);
    expect((t.carry ?? []).filter((p) => !text.types?.[p]), "carried but untyped").toEqual([]);
    expect(own.filter((p) => !text.params?.[p] && !SHARED_PARAMS[p]), "undescribed").toEqual([]);
  });

  it("every shared line is used by a tool that does not override it", () => {
    const used = new Set(
      GRANULAR_TOOLS.flatMap((t) => [...t.params, "container"].filter((p) => !GRANULAR_TEXT[t.name].params?.[p])),
    );
    expect(Object.keys(SHARED_PARAMS).filter((p) => !used.has(p))).toEqual([]);
  });
});

describe("the served granular text", async () => {
  const { tools, instructions } = await served("granular");

  it.each(tools.map((t) => [t.name, t] as const))("%s", (name, tool) => {
    const description = tool.description ?? "";
    expect(description.length).toBeLessThanOrEqual(READ_DESCRIPTION_MAX_CHARS);
    expect(description.split(/(?<=\.) /)[0].length).toBeLessThanOrEqual(HEADLINE_MAX_CHARS);
    expect(description.endsWith(FENCE_POINTER)).toBe(GRANULAR_TEXT[name].fenced === true);
    const whole = JSON.stringify(tool);
    expect(whole).not.toMatch(/\bop=/);
    const named = [...whole.matchAll(/\bdopl_[a-z_]+/g)].map((m) => m[0]);
    expect(named.filter((n) => !GRANULAR_TOOL_NAMES.has(n)), "names a tool the set does not have").toEqual([]);
  });

  it("the instructions name granular tools only, and leave the directory room inside the prefix", () => {
    expect(instructions).not.toMatch(/\bop=/);
    const named = [...instructions.matchAll(/\bdopl_[a-z_]+/g)].map((m) => m[0]);
    expect(named.filter((n) => !GRANULAR_TOOL_NAMES.has(n))).toEqual([]);
    expect(instructions).toContain("alpha");
    expect(instructions.length).toBeLessThanOrEqual(INSTRUCTIONS_MAX_CHARS);
  });

  it("states the body fence once, in the instructions; the legacy briefing does not change", async () => {
    expect(instructions.split(FENCE_DESCRIPTION_NOTE)).toHaveLength(2);
    expect((await served("legacy")).instructions).not.toContain(FENCE_DESCRIPTION_NOTE);
  });
});
