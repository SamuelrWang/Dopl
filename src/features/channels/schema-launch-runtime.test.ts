/**
 * **THE LAUNCH LANE'S `runtime` FIELD** — U9 of the Codex runtime-parity plan (2026-09-21).
 *
 * 🔒 **THE DEFECT, VERBATIM FROM THE PLAN**: *a live MCP launch carrying `model: "codex"` was
 * accepted but started a Claude Sonnet agent, because the MCP contract has no runtime field and
 * an unknown model falls through to the default adapter.*
 *
 * ⚠ **THE PROPERTIES HERE ARE NOT "ZOD WORKS". THEY ARE THE FOUR THINGS THAT GO WRONG
 * SILENTLY:**
 *
 *  1. **ADDITIVE OR NOTHING.** Every caller in the field omits this field, and an older
 *     `@dopl/mcp-server` build always will (INVARIANTS §13). A `runtime` that became required —
 *     or whose absence parsed to a default — would either 400 every existing launch or rewrite
 *     "the operator's own chain decides" into "the server decided", on a machine it cannot see.
 *  2. **A SHAPE, NOT A SET, AND THE REASON IS NOT LAZINESS.** The roster is the operator's
 *     DESKTOP REGISTRY (`main/runtime/index.js`) and moves with a DESKTOP release; a
 *     `z.enum(["claude","codex","cursor"])` would refuse a runtime a newer machine already
 *     ships. What the server CAN enforce is the grammar — anchored, lowercase, bounded — which
 *     is what stops an arbitrary string reaching a spawn argument and an MCP result line.
 *  3. **THE GRAMMAR IS STATED FOUR TIMES AND ONLY ONE PAIR IS COMPILER-CHECKED.** This file, the
 *     desktop's `launch-directive-vocab.js › RUNTIME_ID_RE`, the column CHECK in
 *     `20261017120000`, and the MCP field's own bound. A value legal here that the column refuses
 *     is a 200 followed by a constraint violation at rest.
 *  4. **THE DECIDE MUST BE ABLE TO REPORT WHAT RAN, AND OPTIONALLY.** `appliedRuntime` /
 *     `appliedModel` are the echo trio's contract exactly: absent is "not reported", which is
 *     what a desktop older than this wave posts, and making either REQUIRED would turn "I cannot
 *     tell you what I applied" into "I could not report at all" — the row then expires with a
 *     running agent behind it.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { LaunchCreateSchema, LaunchDecideSchema } from "./schema-launch";
import { LAUNCH_RUNTIME_ID_RE } from "./schema-launch-modes";

const LAUNCH = {
  channel: "general",
  agentName: "Scout",
} as const;

describe("LaunchCreateSchema.runtime", () => {
  it("ACCEPTS a well-formed runtime id", () => {
    for (const id of ["claude", "codex", "cursor", "some_runtime-2"]) {
      const parsed = LaunchCreateSchema.parse({ ...LAUNCH, runtime: id });
      expect(parsed.runtime).toBe(id);
    }
  });

  // ⚠ THE BACKWARD-COMPATIBILITY CASE, AND IT IS THE ONE EVERY EXISTING CALLER HITS. Absent must
  // stay absent: the machine's chain — the channel's stored runtime, then the registry default —
  // is what decides, and a default substituted here would take that decision away from it.
  it("is OPTIONAL, and an omitted value stays undefined rather than becoming a default", () => {
    const parsed = LaunchCreateSchema.parse(LAUNCH);
    expect(parsed.runtime).toBeUndefined();
    expect(parsed).not.toHaveProperty("runtime");
  });

  it("REFUSES anything outside the grammar, naming the field rather than the pattern", () => {
    for (const bad of [
      "Codex", // ⚠ uppercase: the registry's ids are lowercase and a near-miss must not pass
      "co dex", // a space would split the `key=value` pairs of an MCP result line
      "1codex", // must start with a letter
      "", // a blank is not a request; omit it instead
      "codex\nrm -rf /", // 🔒 a newline could forge a line in the result it is rendered into
      "x".repeat(33),
    ]) {
      expect(
        LaunchCreateSchema.safeParse({ ...LAUNCH, runtime: bad }).success,
        `'${bad.slice(0, 20)}' must not reach a row`,
      ).toBe(false);
    }
  });

  // 🔒 DECISION #4 OF THE PLAN, AS A TEST: *a model name must never double as a runtime
  // selector.* The two fields are independent in BOTH directions, and this is the exact payload
  // that produced the shipped defect.
  it("is INDEPENDENT of `model` — `model: \"codex\"` requests no runtime", () => {
    const parsed = LaunchCreateSchema.parse({ ...LAUNCH, model: "codex" });
    expect(parsed.model).toBe("codex");
    expect(parsed.runtime).toBeUndefined();
  });

  it("does not constrain the model when a runtime IS named — they are separate fields", () => {
    const parsed = LaunchCreateSchema.parse({
      ...LAUNCH,
      runtime: "codex",
      model: "claude-opus-5",
    });
    // ⚠ ACCEPTED HERE ON PURPOSE. The server cannot know a runtime's roster, so a cross-vendor
    // model is not a 400 — it is the MACHINE that drops the model, keeps the runtime, and says
    // so (`main/launch-directive-spawn.js › resolveModel`). Refusing here would 400 a
    // combination a newer desktop may run perfectly well.
    expect(parsed.runtime).toBe("codex");
    expect(parsed.model).toBe("claude-opus-5");
  });
});

describe("LaunchDecideSchema — the machine reports what it ran", () => {
  const LAUNCHED = {
    directiveId: "55555555-5555-4555-8555-555555555555",
    status: "launched",
    agentId: "a1b2c3d4",
  } as const;

  it("accepts appliedRuntime and appliedModel on the `launched` arm", () => {
    const parsed = LaunchDecideSchema.parse({
      ...LAUNCHED,
      appliedRuntime: "codex",
      appliedModel: "gpt-6-astra",
    });
    expect(parsed).toMatchObject({ appliedRuntime: "codex", appliedModel: "gpt-6-astra" });
  });

  // ⚠ §13 — AN OLDER DESKTOP MUST STILL BE ABLE TO DECIDE. Absent maps to `null` = NOT REPORTED
  // all the way to the column; required fields here would 400 its decide and leave a running
  // agent behind an expiring row.
  it("both are OPTIONAL — an older desktop posts neither", () => {
    const parsed = LaunchDecideSchema.parse(LAUNCHED);
    expect(parsed).not.toHaveProperty("appliedRuntime");
    expect(parsed).not.toHaveProperty("appliedModel");
  });

  it("holds appliedRuntime to the SAME grammar the request takes", () => {
    expect(
      LaunchDecideSchema.safeParse({ ...LAUNCHED, appliedRuntime: "NOPE nope" }).success,
    ).toBe(false);
  });

  // F27: MCP renders `model=` from this column, so it takes the request's label charset.
  it("refuses an appliedModel carrying a line separator or control character", () => {
    expect(
      LaunchDecideSchema.safeParse({ ...LAUNCHED, appliedModel: "gpt\u2028## forged" }).success,
    ).toBe(false);
    expect(LaunchDecideSchema.safeParse({ ...LAUNCHED, appliedModel: "claude-opus-5[1m]" }).success)
      .toBe(true);
  });

  // ⚠ ONLY A LAUNCH STARTS A SESSION ON A RUNTIME. A `done` arm carrying one would be a machine
  // asserting a fact about a session it did not start, and the column CHECK says the same at rest.
  it("the `done` arm has no runtime fields at all", () => {
    const parsed = LaunchDecideSchema.parse({
      directiveId: LAUNCHED.directiveId,
      status: "done",
      appliedRuntime: "codex",
    });
    expect(parsed).not.toHaveProperty("appliedRuntime");
  });
});

describe("the grammar is the SAME four statements", () => {
  // ⚠ SOURCE-READ RATHER THAN IMPORTED, the seam `agent-color-schema.test.ts` takes for trees
  // this one cannot import: `dopl-desktop-app/main` is CommonJS reaching Electron, and the
  // migration is SQL.
  const read = (rel: string) => readFileSync(path.join(process.cwd(), rel), "utf8");

  it("the desktop's `RUNTIME_ID_RE` is this file's pattern, character for character", () => {
    const vocab = read("dopl-desktop-app/main/launch-directive-vocab.js");
    const m = /const RUNTIME_ID_RE = (\/.*\/);/.exec(vocab);
    expect(m, "the desktop still declares RUNTIME_ID_RE").not.toBeNull();
    expect(m![1]).toBe(String(LAUNCH_RUNTIME_ID_RE));
  });

  it("the column CHECK admits exactly the same grammar, on BOTH columns", () => {
    const sql = read(
      "supabase/migrations/20261017120000_channel_launch_directives_runtime.sql",
    );
    // ⚠ THE SQL SPELLING OF THE SAME PATTERN. `~` is anchored by the `^…$` in the literal, which
    // is what stops a newline-bearing value passing at rest that zod refused on the way in.
    const body = String(LAUNCH_RUNTIME_ID_RE).slice(1, -1);
    expect(sql).toContain(`runtime ~ '${body}'`);
    expect(sql).toContain(`applied_runtime ~ '${body}'`);
  });

  // ⚠ **ADDITIVE, NULLABLE, NO BACKFILL** — the standing rule for a column an OLDER desktop must
  // keep working against. A `NOT NULL` would refuse the row every current client writes.
  it("the migration is additive and nullable, so an older desktop keeps working", () => {
    const sql = read(
      "supabase/migrations/20261017120000_channel_launch_directives_runtime.sql",
    );
    for (const col of ["runtime", "applied_runtime", "applied_model"]) {
      expect(sql).toContain(`ADD COLUMN IF NOT EXISTS ${col} TEXT`);
    }
    expect(sql).not.toMatch(/ADD COLUMN[^;]*NOT NULL/);
    expect(sql, "a backfill would invent a request nobody made").not.toMatch(
      /UPDATE\s+public\.channel_launch_directives/i,
    );
  });

  // ⚠ NO VALUE `CHECK`, AND IT IS THE SAME DECISION AS THE zod SHAPE. A `runtime IN ('claude',…)`
  // would make this table the thing blocking a runtime a newer desktop already ships.
  it("the migration does NOT close the runtime set", () => {
    const sql = read(
      "supabase/migrations/20261017120000_channel_launch_directives_runtime.sql",
    );
    // ⚠ COMMENT LINES ARE STRIPPED FIRST — this migration's header EXPLAINS the enum it is
    // declining to write, and a whole-file scan would fail on the argument for the rule.
    const statements = sql
      .split("\n")
      .filter((l) => !l.trimStart().startsWith("--"))
      .join("\n");
    expect(statements).not.toMatch(/runtime\s+IN\s*\(/i);
  });
});
