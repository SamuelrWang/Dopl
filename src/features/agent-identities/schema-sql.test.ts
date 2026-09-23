/**
 * Each agent-identity bound, stated in four trees that cannot import each other: the migration CHECK
 * (wins), `schema.ts` (the readable 400), MCP `tools/agent.ts` and desktop `identity-resolve.js` (read as
 * source; F-287: a boundary must not undercut the writer). Field count and per-field lengths are zod-only:
 * the DB bounds the serialized `fields` bytes.
 */

import { describe, it, expect } from "vitest";
import {
  MAX_DESCRIPTION_CHARS,
  MAX_FIELDS_BYTES,
  MAX_FIELD_COUNT,
  MAX_FIELD_KEY_CHARS,
  MAX_FIELD_VALUE_CHARS,
  MAX_INSTRUCTIONS_CHARS,
  MAX_MODEL_CHARS,
  MAX_NAME_CHARS,
} from "./schema";
import { statementAt } from "@/shared/supabase/migration-files";
import { FILES } from "@/features/knowledge/migration-replay";
import { readCode } from "@/shared/testing/source-text";
import { LAUNCH_RUNTIME_ID_RE } from "@/features/channels/schema-launch-modes";
import { IDENTITY_FIELD_TYPES } from "./types";

const TABLE = "agent_identities";

/** One migration's replay text (comment-stripped, forward-renamed). */
const migration = (name: string): string => FILES.find((f) => f.name === name)?.sql ?? "";

/** CHECKs live on the table after replaying every migration in apply order; a later DROP/ADD wins. */
function liveConstraints(): Map<string, string> {
  const live = new Map<string, string>();
  const add = new RegExp(
    String.raw`ADD\s+CONSTRAINT\s+(\w+)\s+CHECK\b`,
    "gi"
  );
  const drop = new RegExp(
    String.raw`DROP\s+CONSTRAINT\s+(?:IF\s+EXISTS\s+)?(\w+)`,
    "gi"
  );
  // Replayed forward-renamed: created as `agent_templates*`, read under the final names.
  for (const { sql } of FILES) {
    if (!new RegExp(String.raw`ALTER\s+TABLE\s+(?:public\.)?${TABLE}\b`, "i").test(sql)) {
      continue;
    }
    const events: Array<{ at: number; kind: "add" | "drop"; name: string }> = [];
    // Per statement, not per file: the rename file also alters other tables' CHECKs.
    const onThisTable = (at: number): boolean => {
      const heads = [...sql.slice(0, at).matchAll(/ALTER\s+TABLE\s+(?:public\.)?(\w+)/gi)];
      return heads.length > 0 && heads[heads.length - 1][1] === TABLE;
    };
    for (const m of sql.matchAll(add)) {
      if (m.index !== undefined && onThisTable(m.index)) events.push({ at: m.index, kind: "add", name: m[1] });
    }
    for (const m of sql.matchAll(drop)) {
      if (m.index !== undefined && onThisTable(m.index)) events.push({ at: m.index, kind: "drop", name: m[1] });
    }
    events.sort((a, b) => a.at - b.at);
    for (const e of events) {
      if (e.kind === "drop") live.delete(e.name);
      else live.set(e.name, statementAt(sql, e.at));
    }
  }
  return live;
}

const LIVE = liveConstraints();

/** The one live CHECK by name, or a failure that says which one is missing. */
function constraint(name: string): string {
  const body = LIVE.get(name);
  expect(body, `no live CHECK named ${name} on ${TABLE}`).toBeTruthy();
  return body as string;
}

const MCP = readCode(new URL("../../../packages/mcp-server/src/tools/agent.ts", import.meta.url));
const DESKTOP = readCode(new URL("../../../dopl-desktop-app/main/identity-resolve.js", import.meta.url));

/** `const NAME = 123;` / `const NAME = 32_768;` → 123. Underscores dropped. */
function declared(source: string, name: string): number {
  const m = new RegExp(`const\\s+${name}\\s*=\\s*([0-9_]+)`).exec(source);
  expect(m, `no \`const ${name} = <number>\` declaration`).toBeTruthy();
  return Number((m as RegExpExecArray)[1].replace(/_/g, ""));
}

describe("the replayed CHECK constraints exist at all", () => {
  it("finds the table's constraints (an empty scan must not pass silently)", () => {
    expect(LIVE.size).toBeGreaterThan(0);
  });

  it("all five named bounds are live", () => {
    expect([...LIVE.keys()].sort()).toEqual([
      "agent_identities_fields_shape_check",
      "agent_identities_model_charset_check",
      "agent_identities_name_charset_check",
      "agent_identities_prose_charset_check",
      "agent_identities_runtime_shape_check",
    ]);
  });
});

describe("the zod bounds are the DATABASE's bounds", () => {
  it("name — BETWEEN 1 AND MAX_NAME_CHARS", () => {
    expect(constraint("agent_identities_name_charset_check")).toMatch(
      new RegExp(String.raw`char_length\(name\)\s+BETWEEN\s+1\s+AND\s+${MAX_NAME_CHARS}\b`, "i")
    );
  });

  it("model — BETWEEN 1 AND MAX_MODEL_CHARS", () => {
    expect(constraint("agent_identities_model_charset_check")).toMatch(
      new RegExp(String.raw`char_length\(model\)\s+BETWEEN\s+1\s+AND\s+${MAX_MODEL_CHARS}\b`, "i")
    );
  });

  it("runtime — the launch runtime-id grammar, NULL allowed", () => {
    const runtime = constraint("agent_identities_runtime_shape_check");
    expect(runtime).toMatch(/runtime\s+IS\s+NULL\s+OR/i);
    const m = /runtime\s*~\s*'([^']+)'/.exec(runtime);
    expect(m, "no regex in the runtime CHECK").toBeTruthy();
    expect((m as RegExpExecArray)[1]).toBe(LAUNCH_RUNTIME_ID_RE.source);
  });

  it("description and instructions — the two prose caps, in one constraint", () => {
    const prose = constraint("agent_identities_prose_charset_check");
    expect(prose).toMatch(
      new RegExp(String.raw`char_length\(description\)\s*<=\s*${MAX_DESCRIPTION_CHARS}\b`, "i")
    );
    expect(prose).toMatch(
      new RegExp(String.raw`char_length\(instructions\)\s*<=\s*${MAX_INSTRUCTIONS_CHARS}\b`, "i")
    );
  });

  it("fields — octet_length of the SERIALIZED array, at MAX_FIELDS_BYTES", () => {
    const fields = constraint("agent_identities_fields_shape_check");
    // Bytes of `fields::text`, as zod measures, so a CJK payload cannot pass zod and 500 here.
    expect(fields).toMatch(
      new RegExp(String.raw`octet_length\(fields::text\)\s*<=\s*${MAX_FIELDS_BYTES}\b`, "i")
    );
    expect(fields).toMatch(/jsonb_typeof\(fields\)\s*=\s*'array'/i);
  });

  it("the visibility set is the schema's, and 'public' is not in it", () => {
    // An inline column CHECK in `CREATE TABLE`, not a named constraint.
    const create = migration("20260822200000_agent_templates.sql");
    const m = /visibility\s+TEXT[\s\S]*?CHECK\s*\(visibility\s+IN\s*\(([^)]*)\)\)/i.exec(create);
    expect(m, "no inline visibility CHECK in the create statement").toBeTruthy();
    const sqlSet = [...(m as RegExpExecArray)[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
    expect(sqlSet.sort()).toEqual(["private", "team", "workspace"]);
  });
});

describe("the MCP tool's re-typed bounds are the server's", () => {
  // `packages/mcp-server` cannot import `src/` (INVARIANTS §1), so every number is a named hand copy.
  it.each([
    ["MAX_NAME_CHARS", MAX_NAME_CHARS],
    ["MAX_DESCRIPTION_CHARS", MAX_DESCRIPTION_CHARS],
    ["MAX_INSTRUCTIONS_CHARS", MAX_INSTRUCTIONS_CHARS],
    ["MAX_MODEL_CHARS", MAX_MODEL_CHARS],
    ["MAX_FIELD_COUNT", MAX_FIELD_COUNT],
    ["MAX_FIELD_KEY_CHARS", MAX_FIELD_KEY_CHARS],
    ["MAX_FIELD_VALUE_CHARS", MAX_FIELD_VALUE_CHARS],
  ])("%s", (name, expected) => {
    expect(declared(MCP, name as string)).toBe(expected);
  });

  it("the runtime-id grammar is the launch lane's", () => {
    const m = /const RUNTIME_ID_RE = \/(.+)\/;/.exec(MCP);
    expect(m, "no `const RUNTIME_ID_RE = /…/;` in the tool").toBeTruthy();
    expect((m as RegExpExecArray)[1]).toBe(LAUNCH_RUNTIME_ID_RE.source);
  });

  it("the field-type vocabulary is the product's (DMP-009)", () => {
    const m = /const IDENTITY_FIELD_TYPES = \[([^\]]*)\]/.exec(MCP);
    expect(m, "no `const IDENTITY_FIELD_TYPES = [...]` in the tool").toBeTruthy();
    const listed = [...(m as RegExpExecArray)[1].matchAll(/"([a-z]+)"/g)].map((x) => x[1]);
    expect(listed).toEqual([...IDENTITY_FIELD_TYPES]);
  });

  it("no bare numeric `.max()` is left in the tool schema", () => {
    expect(MCP).not.toMatch(/\.max\(\s*[0-9]/);
  });
});

describe("the desktop BOUNDARY's copy matches the writer's, and does not undercut it", () => {
  it.each([
    ["MAX_INSTRUCTIONS", MAX_INSTRUCTIONS_CHARS],
    ["MAX_FIELDS", MAX_FIELD_COUNT],
    ["MAX_NAME", MAX_NAME_CHARS],
    ["MAX_FIELD_KEY", MAX_FIELD_KEY_CHARS],
    ["MAX_FIELD_VALUE", MAX_FIELD_VALUE_CHARS],
    ["MAX_MODEL", MAX_MODEL_CHARS],
    ["MAX_OVERRIDE_KEY", MAX_FIELD_KEY_CHARS],
    ["MAX_OVERRIDE_VALUE", MAX_FIELD_VALUE_CHARS],
  ])("identity-resolve.js › %s", (name, expected) => {
    expect(declared(DESKTOP, name as string)).toBe(expected);
  });
});

describe("the zod-only bounds, recorded as zod-only", () => {
  it("50 fields at 1000 chars each lands ABOVE the byte cap", () => {
    // Why count and per-field lengths need no CHECK: the byte cap binds first.
    const worst = Array.from({ length: MAX_FIELD_COUNT }, (_, i) => ({
      key: `k${i}`,
      value: "x".repeat(MAX_FIELD_VALUE_CHARS),
    }));
    expect(
      new TextEncoder().encode(JSON.stringify(worst)).length
    ).toBeGreaterThan(MAX_FIELDS_BYTES);
  });
});

/** The attachment table's shape, read out of `20260930150000_agent_template_knowledge_scopes.sql`. */
describe("the knowledge-attachment scope shape", () => {
  const JUNCTION = "agent_identity_knowledge_bases";
  // Forward-renamed: asserted under the final names, not the file's `agent_template_*`.
  const CODE = migration("20260930150000_agent_template_knowledge_scopes.sql");

  it("declares the three kinds and nothing else", () => {
    expect(CODE).toMatch(
      /agent_identity_kb_scope_kind_check[\s\S]*?CHECK\s*\(\s*scope_kind IN \('base', 'folder', 'entry'\)\s*\)/
    );
  });

  // Each arm whole: one arm missing would admit a row naming a folder AND an entry.
  it.each([
    ["base", "scope_kind = 'base'   AND folder_id IS NULL     AND entry_id IS NULL"],
    ["folder", "scope_kind = 'folder' AND folder_id IS NOT NULL AND entry_id IS NULL"],
    ["entry", "scope_kind = 'entry'  AND folder_id IS NULL     AND entry_id IS NOT NULL"],
  ])("the %s arm names exactly its own id column", (_kind, arm) => {
    expect(CODE).toContain(arm);
  });

  // Folders of one base share (identity, base), and two key columns are NULL per shape: hence partial uniques.
  it("replaces the composite PK with a surrogate plus three partial uniques", () => {
    expect(CODE).toMatch(
      new RegExp(String.raw`DROP\s+CONSTRAINT\s+IF\s+EXISTS\s+${JUNCTION}_pkey`, "i")
    );
    expect(CODE).toMatch(/PRIMARY KEY \(id\)/);
    for (const [name, key, arm] of [
      ["agent_identity_kb_base_scope_uniq", "(identity_id, knowledge_base_id)", "base"],
      ["agent_identity_kb_folder_scope_uniq", "(identity_id, folder_id)", "folder"],
      ["agent_identity_kb_entry_scope_uniq", "(identity_id, entry_id)", "entry"],
    ]) {
      // The whole statement: name alone passes a non-partial index; predicate alone, a misnamed one.
      const statement = statementAt(
        CODE,
        CODE.indexOf(`CREATE UNIQUE INDEX IF NOT EXISTS ${name}`)
      );
      expect(CODE, `${name} is gone`).toContain(name);
      expect(statement.replace(/\s+/g, " "), `${name} lost its columns`).toContain(
        `ON public.${JUNCTION} ${key}`
      );
      expect(
        statement.replace(/\s+/g, " "),
        `${name} is no longer partial on ${arm}`
      ).toContain(`WHERE scope_kind = '${arm}'`);
    }
  });

  // The backstop behind the service's 404 for a folder or entry attached under the wrong base.
  it("makes the trigger assert sub-base tenancy AND liveness", () => {
    for (const claim of [
      "IF fld_base <> NEW.knowledge_base_id THEN",
      "IF ent_base <> NEW.knowledge_base_id THEN",
      "IF fld_deleted IS NOT NULL THEN",
      "IF ent_deleted IS NOT NULL THEN",
    ]) {
      expect(CODE, `the trigger no longer asserts: ${claim}`).toContain(claim);
    }
  });

  // The migration asserts its own RLS/grant no-op in a closing `DO $$`; this pins that assertion.
  it("asserts its own RLS/grant no-op rather than trusting it", () => {
    expect(CODE).toContain("gained a non-SELECT policy");
    // Historical name: the rename dropped and re-created this policy rather than renaming it.
    expect(CODE).toContain("agent_template_knowledge_bases_member_select");
    expect(CODE).toContain("authenticated/anon retain DML");
    // No policy of its own; `check-rls-pair-gate.ts`'s twin stays the parent's.
    expect(CODE).not.toMatch(/CREATE\s+POLICY/i);
  });
});
