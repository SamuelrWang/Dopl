/**
 * INVARIANT SUITE — the AGENT-IDENTITY BOUNDS, read out of `supabase/migrations`
 * and compared against every place they are re-typed.
 *
 * 🔒 WHY THIS FILE EXISTS (G3, `docs/DRIFT-LEDGER-2026-08-30.md` §3). The sibling
 * `schema.test.ts` opens by CLAIMING the pairing in prose — *"EVERY ASSERTION
 * HERE HAS A MATCHING `CHECK` IN
 * `supabase/migrations/20260822200000_agent_templates.sql`, and the pairing is
 * the point"* — and then never opens the migration. **A comment claiming a
 * pairing is not a gate.** `schema.test.ts` would pass unchanged if a migration
 * lowered `instructions` to 4 KB tomorrow, and the first sign would be an opaque
 * 500 on an identity the schema had already accepted.
 *
 * ⚠ FOUR STATEMENTS PER BOUND, IN FOUR TREES THAT CANNOT IMPORT EACH OTHER:
 *
 *   1. `supabase/migrations/…_agent_templates.sql`  — the CHECK. **It wins.**
 *   2. `src/features/agent-identities/schema.ts`     — the readable 400.
 *   3. `packages/mcp-server/src/tools/agent.ts`     — the `-32602` before a
 *      round trip. The MCP package cannot import `src/`; these were BARE
 *      LITERALS until 2026-08-30 and are named constants now, which is what
 *      makes them readable from here.
 *   4. `dopl-desktop-app/main/identity-resolve.js`  — the BOUNDARY's own copy,
 *      whose header states the rule this suite enforces: *"a boundary bound must
 *      match the writer's, not undercut it"* (F-287). Its own tree cannot see
 *      `src/` either.
 *
 * …plus `agent-identities/lib/launch-overrides.ts`, whose four numbers mirror the
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
 * the same seam `channels/components/settings-agent-harness.tsx › desktopSource` uses
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
import { forwardRenamed } from "@/shared/supabase/migration-renames";
import { LAUNCH_RUNTIME_ID_RE } from "@/features/channels/schema-launch-modes";

const ROOT = process.cwd();
const MIGRATIONS = join(ROOT, "supabase", "migrations");
const TABLE = "agent_identities";

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
  // ⚠ FORWARD-RENAMED: the table and its constraints were CREATED as `agent_templates*` and
  // renamed on 2026-09-22; the replay reads every file under the final names.
  const files = forwardRenamed(
    readdirSync(MIGRATIONS)
      .filter((f) => f.endsWith(".sql"))
      .sort()
      .map((name) => ({ name, sql: stripLineComments(readFileSync(join(MIGRATIONS, name), "utf8")) }))
  );
  for (const { sql } of files) {
    // Only files that speak about this table at all — a constraint name is
    // unique per table by convention here, but the `ALTER TABLE` is what says
    // which table an `ADD CONSTRAINT` lands on.
    if (!new RegExp(String.raw`ALTER\s+TABLE\s+(?:public\.)?${TABLE}\b`, "i").test(sql)) {
      continue;
    }
    const events: Array<{ at: number; kind: "add" | "drop"; name: string }> = [];
    // ⚠ PER STATEMENT, NOT PER FILE, since the 2026-09-22 rename file: it also ADDs CHECKs to
    // `resource_grants` and `channel_launch_directives`, so an `ADD`/`DROP CONSTRAINT` counts
    // only when the nearest `ALTER TABLE` before it names THIS table.
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

const MCP = readFileSync(
  join(ROOT, "packages", "mcp-server", "src", "tools", "agent.ts"),
  "utf8"
);
const DESKTOP = readFileSync(
  join(ROOT, "dopl-desktop-app", "main", "identity-resolve.js"),
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

describe("🔒 the zod bounds are the DATABASE's bounds", () => {
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
  ])("identity-resolve.js › %s", (name, expected) => {
    expect(declared(DESKTOP, name as string)).toBe(expected);
  });
});

describe("🔒 the launch OVERRIDE caps mirror the durable row's", () => {
  // An override that could be shaped past these would produce a prompt the
  // durable identity could never have held.
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

/**
 * 🔒 THE ATTACHMENT TABLE'S SHAPE — `20260930150000_agent_template_knowledge_scopes.sql`.
 *
 * ⚠ **READ OUT OF THE MIGRATION, NOT ASSERTED FROM MEMORY**, for the reason this
 * file exists at all: the zod union above is what produces a readable 400, the
 * `CHECK` is what makes the union's absence survivable, and a comment claiming
 * the pairing is not a gate.
 *
 * ⚠ **MUTATION-VERIFIED (2026-09-08).** Four reverts, four reds: flipping the
 * base arm's `folder_id IS NULL` to `IS NOT NULL`, deleting the entry arm,
 * deleting either of the two sub-base arms of the trigger, and dropping any one
 * of the three partial unique indexes each turn an assertion below red.
 */
describe("🔒 the knowledge-attachment scope shape", () => {
  const JUNCTION = "agent_identity_knowledge_bases";
  // ⚠ FORWARD-RENAMED: the file speaks `agent_template_knowledge_bases` / `template_id`; the
  // shape is asserted under the names the 2026-09-22 rename gave them.
  const CODE = forwardRenamed(
    readdirSync(MIGRATIONS)
      .filter((f) => f.endsWith(".sql"))
      .sort()
      .map((name) => ({ name, sql: stripLineComments(readFileSync(join(MIGRATIONS, name), "utf8")) }))
  ).find((f) => f.name === "20260930150000_agent_template_knowledge_scopes.sql")?.sql ?? "";

  it("declares the three kinds and nothing else", () => {
    expect(CODE).toMatch(
      /agent_identity_kb_scope_kind_check[\s\S]*?CHECK\s*\(\s*scope_kind IN \('base', 'folder', 'entry'\)\s*\)/
    );
  });

  /**
   * ⚠ **THREE ARMS, EACH PINNED WHOLE.** A shape check with one arm missing is
   * not a looser check — it is a check that ADMITS a row naming a folder AND an
   * entry, which addresses two different things and renders two different tool
   * calls from one attachment.
   */
  it.each([
    ["base", "scope_kind = 'base'   AND folder_id IS NULL     AND entry_id IS NULL"],
    ["folder", "scope_kind = 'folder' AND folder_id IS NOT NULL AND entry_id IS NULL"],
    ["entry", "scope_kind = 'entry'  AND folder_id IS NULL     AND entry_id IS NOT NULL"],
  ])("the %s arm names exactly its own id column", (_kind, arm) => {
    expect(CODE).toContain(arm);
  });

  /**
   * ⚠ **THE OLD PK IS RESTATED PER SHAPE, NOT WIDENED.** `(identity_id,
   * knowledge_base_id)` could not stay a PK — three folders of one base share
   * that pair — and a wider composite is impossible because two of the three key
   * columns are NULL in every shape but their own. So: a surrogate `id`, and
   * three PARTIAL uniques that say what the composite used to.
   */
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
      // ⚠ THE WHOLE STATEMENT, name → columns → partial predicate. Asserting
      // only that the NAME appears would pass a non-partial index (which would
      // refuse a second folder row outright) and an index over the wrong
      // columns; asserting only the predicate would pass one hung on a
      // different name.
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

  /**
   * 🔒 THE TENANCY BACKSTOP. A folder attached under a base it does not live in
   * would render a path naming one base beside a tool call naming another. The
   * service refuses it 404-shaped; this is the fence that keeps a service bug
   * from becoming a silently wrong prompt line.
   */
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

  /** ⚠ RLS AND GRANTS MUST NOT HAVE MOVED — the file adds columns, and adding a
   *  column to a row does not change which rows a policy admits. The migration
   *  asserts this itself in a closing `DO $$`; this asserts the assertion. */
  it("asserts its own RLS/grant no-op rather than trusting it", () => {
    expect(CODE).toContain("gained a non-SELECT policy");
    // The POLICY name is not a renamed object — the rename dropped and re-created it — so the
    // historical file still says its own.
    expect(CODE).toContain("agent_template_knowledge_bases_member_select");
    expect(CODE).toContain("authenticated/anon retain DML");
    // ⚠ It creates NO policy of its own — the twin `check-rls-pair-gate.ts`
    // declares is the parent's and stays the parent's.
    expect(CODE).not.toMatch(/CREATE\s+POLICY/i);
  });
});
