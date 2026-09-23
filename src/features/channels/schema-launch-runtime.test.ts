/**
 * The launch lane's `runtime` field. It is optional (an older `@dopl/mcp-server` omits it, INVARIANTS
 * §13) and a shape, not a set: the roster is the desktop registry's and moves with desktop releases.
 * The grammar is restated in the desktop's `RUNTIME_ID_RE` and the column CHECK, pinned below.
 */

import { describe, it, expect } from "vitest";
import { stripSqlLineComments } from "@/shared/supabase/migration-files";
import { readCode, readSource } from "@/shared/testing/source-text";
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

  // Absent stays absent: the machine's chain (channel runtime, then registry default) decides.
  it("is OPTIONAL, and an omitted value stays undefined rather than becoming a default", () => {
    const parsed = LaunchCreateSchema.parse(LAUNCH);
    expect(parsed.runtime).toBeUndefined();
    expect(parsed).not.toHaveProperty("runtime");
  });

  it("REFUSES anything outside the grammar, naming the field rather than the pattern", () => {
    for (const bad of [
      "Codex", // uppercase: the registry's ids are lowercase
      "co dex", // a space would split the `key=value` pairs of an MCP result line
      "1codex", // must start with a letter
      "", // a blank is not a request; omit it instead
      "codex\nrm -rf /", // a newline could forge a line in the result it is rendered into
      "x".repeat(33),
    ]) {
      expect(
        LaunchCreateSchema.safeParse({ ...LAUNCH, runtime: bad }).success,
        `'${bad.slice(0, 20)}' must not reach a row`,
      ).toBe(false);
    }
  });

  // A model name never doubles as a runtime selector; `model: "codex"` once started a Claude agent.
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
    // Accepted: the machine drops a cross-vendor model and keeps the runtime (`main/launch-directive-spawn.js › resolveModel`).
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

  // An older desktop must still be able to decide (INVARIANTS §13); absent means not reported.
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

  // MCP renders `model=` from this column, so it takes the request's label charset.
  it("refuses an appliedModel carrying a line separator or control character", () => {
    expect(
      LaunchDecideSchema.safeParse({ ...LAUNCHED, appliedModel: "gpt\u2028## forged" }).success,
    ).toBe(false);
    expect(LaunchDecideSchema.safeParse({ ...LAUNCHED, appliedModel: "claude-opus-5[1m]" }).success)
      .toBe(true);
  });

  // Only a launch starts a session on a runtime; the column CHECK says the same at rest.
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
  // Source-read: `dopl-desktop-app/main` is CommonJS outside this module graph, and the migration is SQL.
  const repoFile = (rel: string) => new URL(`../../../${rel}`, import.meta.url);
  const MIGRATION = readSource(
    repoFile("supabase/migrations/20261017120000_channel_launch_directives_runtime.sql"),
  );

  it("the desktop's `RUNTIME_ID_RE` is this file's pattern, character for character", () => {
    const vocab = readCode(repoFile("dopl-desktop-app/main/launch-directive-vocab.js"));
    const m = /const RUNTIME_ID_RE = (\/.*\/);/.exec(vocab);
    expect(m, "the desktop still declares RUNTIME_ID_RE").not.toBeNull();
    expect(m![1]).toBe(String(LAUNCH_RUNTIME_ID_RE));
  });

  it("the column CHECK admits exactly the same grammar, on BOTH columns", () => {
    // The literal's `^…$` anchors Postgres `~`, so a value zod refuses cannot pass at rest.
    const body = String(LAUNCH_RUNTIME_ID_RE).slice(1, -1);
    expect(MIGRATION).toContain(`runtime ~ '${body}'`);
    expect(MIGRATION).toContain(`applied_runtime ~ '${body}'`);
  });

  // A `NOT NULL` would refuse the row every current client writes.
  it("the migration is additive and nullable, so an older desktop keeps working", () => {
    for (const col of ["runtime", "applied_runtime", "applied_model"]) {
      expect(MIGRATION).toContain(`ADD COLUMN IF NOT EXISTS ${col} TEXT`);
    }
    expect(MIGRATION).not.toMatch(/ADD COLUMN[^;]*NOT NULL/);
    expect(MIGRATION, "a backfill would invent a request nobody made").not.toMatch(
      /UPDATE\s+public\.channel_launch_directives/i,
    );
  });

  // No value CHECK, for the same reason zod takes a shape: a newer desktop may ship another runtime.
  it("the migration does NOT close the runtime set", () => {
    // Comments stripped: the header explains the enum it declines to write.
    expect(stripSqlLineComments(MIGRATION)).not.toMatch(/runtime\s+IN\s*\(/i);
  });
});
