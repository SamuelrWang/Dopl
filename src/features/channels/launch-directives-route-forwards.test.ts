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
import { LaunchCreateSchema, LaunchDecideSchema } from "./schema-launch";

const ROUTE_PATH = path.join(
  process.cwd(),
  "src/app/api/channels/launch-directives/route.ts",
);

/**
 * ⚠ **THE DECIDE HANDLER ENUMERATES FIELDS TOO, AND IT HAD ALREADY LOST ONE** (found
 * 2026-09-21, while U9 added two more to the same object).
 *
 * 🔒 **`appliedAgentName` WAS VALIDATED, TYPED, STORED-FOR AND DROPPED.** It reached
 * `LaunchDecideSchema`, `DecideLaunchInput`, `applied_agent_name` and the DTO — every layer
 * built — and `decide/route.ts › handlePost` never mentioned it, so the machine's real name for
 * the agent never reached a row. The MCP result then rendered `name=(not reported)` for an agent
 * that HAD been named, on the one field Samuel's 2026-09-15 ruling makes the ADDRESS. That is
 * F-708 for the third time on this lane, in the other direction, and it is why this file now
 * guards BOTH handlers rather than only the create.
 */
const DECIDE_ROUTE_PATH = path.join(
  process.cwd(),
  "src/app/api/channels/launch-directives/decide/route.ts",
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

/**
 * THE `launched` ARM of `LaunchDecideSchema`, as the handler re-builds it.
 *
 * ⚠ ANCHORED ON THE ARM, NOT THE FILE. The handler's ternary also builds a `done` and a
 * `refused` object, and a whole-file scan would pass because some other arm happened to mention
 * the key.
 */
function decidedKeys(): Set<string> {
  const src = readFileSync(DECIDE_ROUTE_PATH, "utf8");
  const arm = /status:\s*"launched",([\s\S]*?)\n\s*\}\n/.exec(src);
  expect(arm, "the decide handler no longer builds a `launched` arm").not.toBeNull();
  const keys = new Set<string>();
  for (const line of arm![1].split("\n")) {
    const code = line.trim();
    if (code.startsWith("//") || code.startsWith("*") || code.startsWith("/*")) continue;
    const key = /^(\w+):/.exec(code);
    if (key) keys.add(key[1]);
  }
  return keys;
}

describe("POST /api/channels/launch-directives/decide — the machine's whole report lands", () => {
  it("forwards every `launched`-arm field the schema validates", () => {
    // ⚠ THE SHAPE OF A DISCRIMINATED-UNION ARM, read off the schema rather than hand-listed, so
    // the field added next month is covered by the case written today.
    const arm = LaunchDecideSchema.options.find(
      (o) => o.shape.status.value === "launched",
    );
    expect(arm, "the schema still has a `launched` arm").toBeDefined();
    // ⚠ `status` IS THE DISCRIMINATOR AND `directiveId` IS A SEPARATE ARGUMENT to the service —
    // `decideLaunchDirective(ctx, input.directiveId, { … })` — so neither belongs in the object
    // this case reads. Everything else the machine reported does.
    const schemaKeys = Object.keys(arm!.shape).filter(
      (k) => k !== "status" && k !== "directiveId",
    );
    const forwarded = decidedKeys();
    const missing = schemaKeys.filter((k) => !forwarded.has(k));
    expect(
      missing,
      `the machine REPORTED these and the route DROPS them, so the row records "not reported" `
        + `for something that was reported: ${missing.join(", ")}`,
    ).toEqual([]);
  });

  /**
   * ⚠ **THE THREE THE DEFECTS WERE ABOUT, NAMED.** `appliedAgentName` is the one that was
   * actually lost; `appliedRuntime` / `appliedModel` are U9's pair, added to the same object
   * the same day this was found — which is precisely the situation where a fourth goes missing.
   */
  it("forwards appliedAgentName, appliedRuntime and appliedModel by name", () => {
    const forwarded = decidedKeys();
    for (const k of ["appliedAgentName", "appliedRuntime", "appliedModel"]) {
      expect(forwarded.has(k), `${k} is dropped by the decide handler`).toBe(true);
    }
  });
});
