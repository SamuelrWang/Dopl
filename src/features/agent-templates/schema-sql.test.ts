/**
 * INVARIANT SUITE — the AGENT-TEMPLATE BOUNDS, read out of `supabase/migrations`
 * and compared against every place they are re-typed.
 *
 * 🔒 WHY THIS FILE EXISTS (G3, `docs/DRIFT-LEDGER-2026-08-30.md` §3). The sibling
 * `schema.test.ts` opens by CLAIMING the pairing in prose — *"EVERY ASSERTION
 * HERE HAS A MATCHING `CHECK` IN
 * `supabase/migrations/20260822200000_agent_templates.sql`, and the pairing is
 * the point"* — and then never opens the migration. **A comment claiming a
 * pairing is not a gate.** `schema.test.ts` would pass unchanged if a migration
 * lowered `instructions` to 4 KB tomorrow, and the first sign would be an opaque
 * 500 on a template the schema had already accepted.
 *
 * ⚠ FOUR STATEMENTS PER BOUND, IN FOUR TREES THAT CANNOT IMPORT EACH OTHER:
 *
 *   1. `supabase/migrations/…_agent_templates.sql`  — the CHECK. **It wins.**
 *   2. `src/features/agent-templates/schema.ts`     — the readable 400.
 *   3. `packages/mcp-server/src/tools/agent.ts`     — the `-32602` before a
 *      round trip. The MCP package cannot import `src/`; these were BARE
 *      LITERALS until 2026-08-30 and are named constants now, which is what
 *      makes them readable from here.
 *   4. `dopl-desktop-app/main/template-resolve.js`  — the BOUNDARY's own copy,
 *      whose header states the rule this suite enforces: *"a boundary bound must
 *      match the writer's, not undercut it"* (F-287). Its own tree cannot see
 *      `src/` either.
 *
 * …plus `agent-templates/lib/launch-overrides.ts`, whose four numbers mirror the
 * per-field caps so an EPHEMERAL override cannot be shaped in a way the durable
 * row could never have held.
 *
 * ⚠ NOT EVERY BOUND HAS A `CHECK`, AND THAT IS DELIBERATE — stated here so the
 * next reader does not "fix" it. The migration bounds the SERIALIZED size of
 * `fields` (`octet_length(fields::text) <= 8192`) and its array-ness, and leaves
 * element shape to zod, on the reasoning its own comment gives. So
 * `MAX_FIELD_COUNT` (50), `MAX_FIELD_VALUE_CHARS` (1000) and
 * `MAX_FIELD_KEY_CHARS` (80) are compared ACROSS TREES but never against SQL;
 * the byte cap is the contract they sit inside.
 *
 * ⚠ SOURCE READ, NOT IMPORT, for trees 3 and 4. Neither is in the root vitest
 * project's module graph; the root project runs with `process.cwd()` at the
 * repo root, so a `readFileSync` resolves with no alias and no second config —
 * the same seam `channels-v2/settings-agent-harness.tsx › desktopSource` uses
 * for the desktop main modules.
 *
 * ⚠ MUTATION-VERIFIED (2026-08-30): changing the migration's `32768`, the MCP
 * copy's `MAX_INSTRUCTIONS_CHARS`, or the desktop's `MAX_FIELD_VALUE` each turns
 * an assertion below red.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
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
import {
  MAX_OVERRIDE_FIELD_COUNT,
  MAX_OVERRIDE_FIELDS_BYTES,
  MAX_OVERRIDE_KEY_CHARS,
  MAX_OVERRIDE_VALUE_CHARS,
} from "./lib/launch-overrides";

const ROOT = process.cwd();
const MIGRATIONS = join(ROOT, "supabase", "migrations");
const TABLE = "agent_templates";

function stripLineComments(sql: string): string {
  return sql
    .split("\n")
    .map((line) => {
      const at = line.indexOf("--");
      return at === -1 ? line : line.slice(0, at);
    })
    .join("\n");
}

/** The statement starting at `from`, up to the first `;` at paren depth 0. */
function statementAt(sql: string, from: number): string {
  let depth = 0;
  for (let i = from; i < sql.length; i++) {
    if (sql[i] === "(") depth++;
    else if (sql[i] === ")") depth--;
    else if (sql[i] === ";" && depth === 0) return sql.slice(from, i + 1);
  }
  return sql.slice(from);
}

/**
 * REPLAY the migrations and answer with the CHECK constraints LIVE on the table
 * at the end — `ADD CONSTRAINT` inserts, `DROP CONSTRAINT` removes, later wins.
 *
 * ⚠ THE REPLAY IS THE POINT, exactly as in `knowledge/schema-sql.test.ts`. Only
 * one migration defines these today, but a test that read that one file by name
 * would pass while a later `DROP CONSTRAINT … ; ADD CONSTRAINT …` sat beside it
 * at a looser number. Files are read in FILENAME order, which is apply order.
 */
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
  const files = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const name of files) {
    const sql = stripLineComments(readFileSync(join(MIGRATIONS, name), "utf8"));
    // Only files that speak about this table at all — a constraint name is
    // unique per table by convention here, but the `ALTER TABLE` is what says
    // which table an `ADD CONSTRAINT` lands on.
    if (!new RegExp(String.raw`ALTER\s+TABLE\s+(?:public\.)?${TABLE}\b`, "i").test(sql)) {
      continue;
    }
    const events: Array<{ at: number; kind: "add" | "drop"; name: string }> = [];
    for (const m of sql.matchAll(add)) {
      if (m.index !== undefined) events.push({ at: m.index, kind: "add", name: m[1] });
    }
    for (const m of sql.matchAll(drop)) {
      if (m.index !== undefined) events.push({ at: m.index, kind: "drop", name: m[1] });
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

const MCP = readFileSync(
  join(ROOT, "packages", "mcp-server", "src", "tools", "agent.ts"),
  "utf8"
);
const DESKTOP = readFileSync(
  join(ROOT, "dopl-desktop-app", "main", "template-resolve.js"),
  "utf8"
);

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

  it("all four named bounds are live", () => {
    expect([...LIVE.keys()].sort()).toEqual([
      "agent_templates_fields_shape_check",
      "agent_templates_model_charset_check",
      "agent_templates_name_charset_check",
      "agent_templates_prose_charset_check",
    ]);
  });
});

describe("🔒 the zod bounds are the DATABASE's bounds", () => {
  it("name — BETWEEN 1 AND MAX_NAME_CHARS", () => {
    expect(constraint("agent_templates_name_charset_check")).toMatch(
      new RegExp(String.raw`char_length\(name\)\s+BETWEEN\s+1\s+AND\s+${MAX_NAME_CHARS}\b`, "i")
    );
  });

  it("model — BETWEEN 1 AND MAX_MODEL_CHARS", () => {
    expect(constraint("agent_templates_model_charset_check")).toMatch(
      new RegExp(String.raw`char_length\(model\)\s+BETWEEN\s+1\s+AND\s+${MAX_MODEL_CHARS}\b`, "i")
    );
  });

  it("description and instructions — the two prose caps, in one constraint", () => {
    const prose = constraint("agent_templates_prose_charset_check");
    expect(prose).toMatch(
      new RegExp(String.raw`char_length\(description\)\s*<=\s*${MAX_DESCRIPTION_CHARS}\b`, "i")
    );
    expect(prose).toMatch(
      new RegExp(String.raw`char_length\(instructions\)\s*<=\s*${MAX_INSTRUCTIONS_CHARS}\b`, "i")
    );
  });

  it("fields — octet_length of the SERIALIZED array, at MAX_FIELDS_BYTES", () => {
    const fields = constraint("agent_templates_fields_shape_check");
    // ⚠ BYTES of `fields::text`, not `pg_column_size`: zod measures the same
    // way (`new TextEncoder().encode(JSON.stringify(fields)).length`), so a CJK
    // payload cannot pass zod and then fail here as an opaque 500.
    expect(fields).toMatch(
      new RegExp(String.raw`octet_length\(fields::text\)\s*<=\s*${MAX_FIELDS_BYTES}\b`, "i")
    );
    expect(fields).toMatch(/jsonb_typeof\(fields\)\s*=\s*'array'/i);
  });

  it("the visibility set is the schema's, and 'public' is not in it", () => {
    // ⚠ A COLUMN-LEVEL CHECK, not one of the four named ones — it is written
    // inline in `CREATE TABLE`, so it is read out of that statement.
    const create = stripLineComments(
      readFileSync(join(MIGRATIONS, "20260822200000_agent_templates.sql"), "utf8")
    );
    const m = /visibility\s+TEXT[\s\S]*?CHECK\s*\(visibility\s+IN\s*\(([^)]*)\)\)/i.exec(create);
    expect(m, "no inline visibility CHECK in the create statement").toBeTruthy();
    const sqlSet = [...(m as RegExpExecArray)[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
    expect(sqlSet.sort()).toEqual(["private", "team", "workspace"]);
  });
});

describe("🔒 the MCP tool's re-typed bounds are the server's", () => {
  // ⚠ `packages/mcp-server` cannot import from `src/` (INVARIANTS §1), so every
  // number in its tool schema is a hand copy. Named since 2026-08-30 so this
  // comparison is possible at all.
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

  it("no bare numeric `.max()` is left in the tool schema", () => {
    // The whole point of naming them: a literal reintroduced beside a named
    // constant is invisible to the assertions above.
    const code = MCP.split("\n")
      .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
      .join("\n");
    expect(code).not.toMatch(/\.max\(\s*[0-9]/);
  });
});

describe("🔒 the desktop BOUNDARY's copy matches the writer's, and does not undercut it", () => {
  // F-287's rule, in an executable form: a boundary that enforces a SMALLER
  // number than the far side enforces is this module inventing a limit the
  // operator can neither see nor satisfy.
  it.each([
    ["MAX_INSTRUCTIONS", MAX_INSTRUCTIONS_CHARS],
    ["MAX_FIELDS", MAX_FIELD_COUNT],
    ["MAX_NAME", MAX_NAME_CHARS],
    ["MAX_FIELD_KEY", MAX_FIELD_KEY_CHARS],
    ["MAX_FIELD_VALUE", MAX_FIELD_VALUE_CHARS],
    ["MAX_MODEL", MAX_MODEL_CHARS],
  ])("template-resolve.js › %s", (name, expected) => {
    expect(declared(DESKTOP, name as string)).toBe(expected);
  });
});

describe("🔒 the launch OVERRIDE caps mirror the durable row's", () => {
  // An override that could be shaped past these would produce a prompt the
  // durable template could never have held.
  it("the four numbers agree with schema.ts", () => {
    expect(MAX_OVERRIDE_KEY_CHARS).toBe(MAX_FIELD_KEY_CHARS);
    expect(MAX_OVERRIDE_VALUE_CHARS).toBe(MAX_FIELD_VALUE_CHARS);
    expect(MAX_OVERRIDE_FIELD_COUNT).toBe(MAX_FIELD_COUNT);
    expect(MAX_OVERRIDE_FIELDS_BYTES).toBe(MAX_FIELDS_BYTES);
  });
});

describe("the zod-only bounds, recorded as zod-only", () => {
  it("50 fields at 1000 chars each lands ABOVE the byte cap", () => {
    // ⚠ THIS IS WHY THE COUNT AND THE PER-FIELD LENGTHS NEED NO `CHECK`. The
    // byte cap is the binding constraint and the DB holds it; the two above are
    // sanity rails that produce a readable message before the bytes do.
    const worst = Array.from({ length: MAX_FIELD_COUNT }, (_, i) => ({
      key: `k${i}`,
      value: "x".repeat(MAX_FIELD_VALUE_CHARS),
    }));
    expect(
      new TextEncoder().encode(JSON.stringify(worst)).length
    ).toBeGreaterThan(MAX_FIELDS_BYTES);
  });
});
