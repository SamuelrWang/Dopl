/**
 * INVARIANT SUITE — **EVERY `LaunchCreateSchema` FIELD REACHES THE SERVICE** (F-708,
 * 2026-09-16).
 *
 * 🔒 **WHY THIS FILE EXISTS.** `src/app/api/channels/launch-directives/route.ts › handlePost`
 * builds the service input BY ENUMERATING FIELDS. Every layer of the launch lane is typed —
 * the zod schema, `CreateLaunchDirectiveInput`, the column, the claim DTO, the desktop's wire
 * narrowing, the spawn — and NONE of them can see this omission, because a field the handler
 * never mentions is an OPTIONAL property left `undefined`, which is not a type error anywhere.
 *
 * ⚠ **IT HAS ALREADY HAPPENED TWICE, WHICH IS WHAT MAKES IT A RULE RATHER THAN A CAUTION.**
 * `color` (2026-09-13) and `agentName` (2026-09-15) were both added to the schema and to the
 * service input and both were dropped at this handler. The agent-name case is the readable
 * one: the row stored `NULL`, the desktop applied its older-client fallback `New Agent`
 * (`main/launch-directive-spawn.js`), the uniqueness rule suffixed the siblings, and the web
 * @-picker minted `new-agent` / `new-agent-1` from that default — a slug derived from a name
 * nobody asked for, the exact inversion of Samuel's ruling (*the NAME is authoritative, the
 * slug is derived from it, never the reverse*). And the MCP op REPORTED the asked-for name,
 * because `channel-ops-launch.ts`'s echo falls back to the request when the machine reports no
 * applied name — so nothing anywhere said a word.
 *
 * ⚠ **SOURCE READ, NOT IMPORT, AND THAT IS THE ONLY SEAM THAT WORKS HERE.** The assertion is
 * about a route module's TEXT: importing the handler would need `next/server`, a workspace auth
 * context and a supabase admin client, and would still only prove the ONE field a fixture
 * happened to carry. Reading the call site proves it for every field the schema has, including
 * the one added next month. Same seam `agent-color-schema.test.ts` takes for trees it cannot
 * import.
 *
 * ⚠ **MUTATION-VERIFIED (2026-09-16):** deleting either `color:` or `agentName:` from the
 * handler's `createLaunchDirective({ … })` object turns the first case below red and names the
 * missing field in the failure message.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LaunchCreateSchema } from "./schema-launch";

const ROUTE_PATH = path.join(
  process.cwd(),
  "src/app/api/channels/launch-directives/route.ts",
);

/**
 * The handler's `createLaunchDirective(ctx, { … })` argument, verbatim.
 *
 * ⚠ ANCHORED ON THE CALL AND NOT ON THE FILE, deliberately: the file also mentions several of
 * these names in its header prose, and a whole-file `includes` would pass on a comment.
 */
function serviceInputSource(): string {
  const src = readFileSync(ROUTE_PATH, "utf8");
  const call = /createLaunchDirective\(ctx,\s*\{([\s\S]*?)\n\s*\}\);/.exec(src);
  expect(call, "handlePost no longer calls createLaunchDirective(ctx, { … })")
    .not.toBeNull();
  return call![1];
}

/** The keys the handler actually writes onto the service input. */
function forwardedKeys(): Set<string> {
  const keys = new Set<string>();
  for (const line of serviceInputSource().split("\n")) {
    // ⚠ COMMENT LINES ARE SKIPPED FIRST. This lane's comments name its fields constantly.
    const code = line.trim();
    if (code.startsWith("//") || code.startsWith("*") || code.startsWith("/*")) continue;
    const key = /^(\w+):/.exec(code);
    if (key) keys.add(key[1]);
  }
  return keys;
}

describe("POST /api/channels/launch-directives — the handler forwards the whole schema", () => {
  it("passes every LaunchCreateSchema field to createLaunchDirective", () => {
    const schemaKeys = Object.keys(LaunchCreateSchema.shape);
    const forwarded = forwardedKeys();
    const missing = schemaKeys.filter((k) => !forwarded.has(k));
    expect(
      missing,
      `these validated fields are DROPPED by the route handler and reach no row: ${missing.join(", ")}`,
    ).toEqual([]);
  });

  /**
   * ⚠ **THE TWO THE DEFECT WAS ABOUT, NAMED.** The case above is the general rule and would
   * survive a schema rename; these two are the field report, and a future refactor that loses
   * the launch NAME again should fail a test that says the word.
   */
  it("forwards agentName and color by name", () => {
    const forwarded = forwardedKeys();
    expect(forwarded.has("agentName")).toBe(true);
    expect(forwarded.has("color")).toBe(true);
  });

  /**
   * ⚠ **AND IT MAY NOT INVENT A FIELD EITHER.** A key the handler passes that the schema does
   * not have is a value no caller can set and no validator bounded — the other direction of the
   * same drift, and cheap to pin while we are reading the call site.
   */
  it("passes nothing the schema does not carry", () => {
    const schemaKeys = new Set(Object.keys(LaunchCreateSchema.shape));
    const invented = [...forwardedKeys()].filter((k) => !schemaKeys.has(k));
    expect(invented, `not on LaunchCreateSchema: ${invented.join(", ")}`).toEqual([]);
  });
});
