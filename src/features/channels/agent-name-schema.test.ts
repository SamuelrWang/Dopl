import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { mentionSlug } from "./lib/mentions";
import { NEW_AGENT_NAME } from "@/shared/lib/agent-name";
import { launchedTag } from "../../../packages/mcp-server/src/tools/channel-ops-launch-name";

/**
 * INVARIANT SUITE — **THE LAUNCH NAME'S CHARSET, READ OUT OF THE MIGRATIONS** (Samuel,
 * 2026-09-15: *"if agents are spinning up agents, they should be the ones that are naming the
 * agent"*).
 *
 * 🔒 **A CHARACTER CLASS IS THE ONE KIND OF CONSTRAINT NO OTHER GATE CAN READ.** No suite in this
 * repo executes SQL, and `supabase db reset` replays a CHECK happily because CREATING a
 * constraint is not INSERTING through one — so a wrong class is green everywhere until
 * production raises `23514`.
 *
 * ⚠ **THAT IS NOT HYPOTHETICAL.** `20261006120000` writes each class twice, once with `\uXXXX`
 * escapes and once with the literal characters, and **the literal twin reached disk with U+2028
 * and U+202F flattened to plain U+0020** — turning `\u2028-\u202F` into `\u0020-\u0020` and
 * making both columns **forbid a space**. `Bug reviewer`, `Research bot` and `New Agent` would
 * every one have failed on the INSERT. That file is APPLIED IN PRODUCTION (2026-09-15) and is
 * therefore never edited; `20261006130000` supersedes it, in escapes only.
 *
 * ⚠ **SO THIS SUITE READS THE LAST WRITER, NOT ONE FILE.** Postgres keeps whichever re-add ran
 * last, so the assertions below resolve each column's class the same way — by filename order
 * across every migration that re-adds that constraint. A future migration that re-corrupts the
 * class goes red here without anybody remembering to update this file.
 */

const MIGRATIONS = join(process.cwd(), "supabase", "migrations");

/** Every migration file, in apply order (the filename's timestamp IS that order). */
const FILES = readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith(".sql"))
  .sort();

function sqlOf(file: string): string {
  return readFileSync(join(MIGRATIONS, file), "utf8");
}

/**
 * Every `<column> !~ '<class>'` clause in one SQL text, as written.
 * ⚠ THE LOOKBEHIND IS LOAD-BEARING: `applied_agent_name` ENDS WITH `agent_name`, so a bare
 * substring match reports one column's clauses under the other's name.
 */
function classesFor(sql: string, column: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`(?<![A-Za-z0-9_])${column} !~ '(\\[[^']*\\])'`, "g");
  for (const m of sql.matchAll(re)) out.push(m[1]);
  return out;
}

/**
 * The class Postgres actually ends up enforcing for `column`: the one written by the LAST
 * migration that re-adds its charset constraint. ⚠ NOT "the file that introduced the column" —
 * that is exactly the reading that would call a superseded bug live.
 */
function liveClassesFor(column: string): { file: string; classes: string[] } {
  let found = { file: "", classes: [] as string[] };
  for (const file of FILES) {
    const sql = sqlOf(file);
    if (!sql.includes(`ADD CONSTRAINT channel_launch_directives_${column}_charset_check`)) {
      continue;
    }
    const classes = classesFor(sql, column);
    if (classes.length > 0) found = { file, classes };
  }
  return found;
}

/**
 * The codepoints one POSIX bracket class forbids. Understands the `\uXXXX` escapes Postgres ARE
 * accepts, so the escaped spelling and the literal spelling reduce to the same set.
 */
function forbidden(cls: string): Set<number> {
  const body = cls.slice(1, -1).replace(/\\u([0-9A-Fa-f]{4})/g, (_, hex) =>
    String.fromCharCode(parseInt(hex, 16))
  );
  const out = new Set<number>();
  for (let i = 0; i < body.length; i += 1) {
    if (body[i + 1] === "-" && i + 2 < body.length) {
      for (let c = body.charCodeAt(i); c <= body.charCodeAt(i + 2); c += 1) out.add(c);
      i += 2;
    } else {
      out.add(body.charCodeAt(i));
    }
  }
  return out;
}

const COLUMNS = ["agent_name", "applied_agent_name"] as const;
const FIX_FILE = "20261006130000_channel_launch_directives_agent_name_charset_fix.sql";
const APPLIED_FILE = "20261006120000_channel_launch_directives_agent_name.sql";

describe("channel_launch_directives — the agent name's charset", () => {
  const target = classesFor(
    sqlOf("20260907120000_channel_launch_directives_kind.sql"),
    "target_name"
  ).map(forbidden);

  it("🔒 `target_name`'s two spellings agree — the class this rule descends from", () => {
    expect(target).toHaveLength(2);
    expect([...target[0]].sort()).toEqual([...target[1]].sort());
  });

  /**
   * 🔒 **THE APPLIED FILE IS NOT EDITED IN PLACE, AND THIS CASE IS WHY THE FIX FILE EXISTS.**
   * `20261006120000` ran against production on 2026-09-15 with the flattened class in it;
   * migrations are matched by NAME, so changing those bytes would put the recorded hash and the
   * replayed file out of step. If this ever goes green-by-absence — the corruption gone from that
   * file — somebody edited an applied migration and the fix file below became a silent no-op.
   */
  it("🔒 the corrupted class is STILL in the applied file — it was superseded, not rewritten", () => {
    const flattened = classesFor(sqlOf(APPLIED_FILE), "agent_name").filter((cls) =>
      forbidden(cls).has(0x20)
    );
    expect(flattened.length).toBeGreaterThan(0);
  });

  for (const column of COLUMNS) {
    const live = liveClassesFor(column);

    it(`🔒 ${column}'s live class comes from the fix migration`, () => {
      expect(live.file).toBe(FIX_FILE);
      expect(live.classes).toHaveLength(1);
    });

    /**
     * 🔒 **A SPACE IS NOT A FORBIDDEN CHARACTER.** The flattened twin read ` - `; a name
     * with a space in it failed the CHECK. This is the case the whole fix exists for.
     */
    it(`🔒 ${column} admits a SPACE — "Bug reviewer" is a legal name`, () => {
      for (const cls of live.classes) expect(forbidden(cls).has(0x20)).toBe(false);
    });

    it(`🔒 ${column} forbids exactly what target_name forbids`, () => {
      for (const cls of live.classes) {
        expect([...forbidden(cls)].sort()).toEqual([...target[0]].sort());
      }
    });

    it(`🔒 ${column} is still bounded at 60 — main/agent-names.js › MAX_NAME`, () => {
      expect(sqlOf(live.file)).toContain(`char_length(${column}) BETWEEN 1 AND 60`);
    });
  }

  /**
   * 🔒 **THE FIX FILE WRITES THE CLASS IN ESCAPES ONLY, AND THAT IS THE DURABLE GUARD.** A rule
   * spelled in invisible characters is a rule an editor, a paste, a terminal or a diff viewer can
   * silently rewrite — which is exactly how this bug arrived. Postgres ARE understands `\uXXXX`,
   * so the escape form is the complete rule on its own and it is the only form that survives
   * being moved.
   */
  it("🔒 the fix migration contains NO literal invisible character in any regex", () => {
    for (const cls of classesFor(sqlOf(FIX_FILE), "agent_name").concat(
      classesFor(sqlOf(FIX_FILE), "applied_agent_name")
    )) {
      const literals = [...cls].filter((c) => c.charCodeAt(0) > 0x7e);
      expect(literals).toEqual([]);
    }
  });

  /** ⚠ A CHECK IS ONE EXPRESSION, so re-adding it re-adds the bound and the `btrim` rule with it.
   *  Dropping either on the way through would quietly widen the column. */
  it("🔒 the fix re-adds the WHOLE predicate, not just the class", () => {
    const sql = sqlOf(FIX_FILE);
    for (const column of COLUMNS) {
      expect(sql).toContain(`DROP CONSTRAINT IF EXISTS channel_launch_directives_${column}_charset_check`);
      expect(sql).toContain(`${column} = btrim(${column})`);
      expect(sql).toContain(`${column} IS NULL OR (`);
    }
  });

  /** ⚠ SOURCE READ, not import: `dopl-desktop-app/` is not in this vitest project's module
   *  graph. The same seam `agent-color-schema.test.ts` takes for the same reason. */
  it("🔒 60 is the desktop store's own bound, not a number re-typed in SQL", () => {
    const names = readFileSync(
      join(process.cwd(), "dopl-desktop-app", "main", "agent-names.js"),
      "utf8"
    );
    expect(names).toMatch(/const MAX_NAME = 60;/);
  });
});

/**
 * **THE SAME NAME, SPELLED IN FOUR TREES THAT CANNOT IMPORT EACH OTHER** (2026-09-15).
 *
 * 🔒 **A NAMING RULE THAT SPELLS A NAME DIFFERENTLY FROM THE PARSER IS A SILENT "the agent
 * ignored me".** The slug is what an author types (`@bug-reviewer`) and what the uniqueness rule
 * compares by, so these four must agree character for character:
 *   1. `src/features/channels/lib/mentions.ts › mentionSlug` — the web parser. **It wins.**
 *   2. `dopl-desktop-app/main/agent-handles.js › agentSlug` — main's parser.
 *   3. `dopl-desktop-app/main/agent-name-unique.js › nameSlug` — main's WRITER
 *      (`test/agent-name-unique.test.mjs` pins it against 2; this pins that pair against 1).
 *   4. `packages/mcp-server/src/tools/channel-ops-launch-name.ts › launchedTag` — what the launch
 *      result publishes as the tag to type.
 *
 * ⚠ SOURCE READ for the two `dopl-desktop-app` copies: that tree is not in this vitest project's
 * module graph. The same seam `agent-color-schema.test.ts` takes, for its reason.
 */
describe("the agent handle's slug, across the trees that restate it", () => {
  const FIXTURES = [
    "Coder",
    "Bug Reviewer",
    "  Bug   Reviewer ",
    "Coder-1",
    "New Agent",
    "MAIN",
  ];

  /** One `.replace(/\s+/g, "-")`-style slugger, lifted out of a main-process module. */
  function mainSlugger(file: string, fn: string): (s: string) => string {
    const src = readFileSync(join(process.cwd(), "dopl-desktop-app", "main", file), "utf8");
    const m = src.match(new RegExp(`function ${fn}\\(source\\) \\{[\\s\\S]*?\\n\\}`));
    expect(m, `${file} › ${fn} not found`).toBeTruthy();
    return new Function(`${m![0]}; return ${fn};`)() as (s: string) => string;
  }

  it("🔒 all four spellings agree, fixture for fixture", () => {
    const agentSlug = mainSlugger("agent-handles.js", "agentSlug");
    const nameSlug = mainSlugger("agent-name-unique.js", "nameSlug");
    for (const source of FIXTURES) {
      const web = mentionSlug(source);
      expect(agentSlug(source), source).toBe(web);
      expect(nameSlug(source), source).toBe(web);
      // ⚠ `launchedTag` PUBLISHES THE ADDRESS, so it carries the `@` the others do not.
      expect(launchedTag(source), source).toBe(`@${web}`);
    }
  });

  /**
   * 🔒 **THE FACE AN UNNAMED AGENT WEARS IS ONE STRING** (Samuel, 2026-09-15: *"if a user
   * launches an agent with no name, just give it the name, New Agent."*). `src/shared/lib/
   * agent-name.ts` is the source; `main/launch-directive-spawn.js` hand-copies it for the
   * older-client arm and cannot import it.
   */
  it("🔒 `New Agent` is the same string in main as in `shared/lib/agent-name.ts`", () => {
    const spawn = readFileSync(
      join(process.cwd(), "dopl-desktop-app", "main", "launch-directive-spawn.js"),
      "utf8"
    );
    const m = spawn.match(/const NEW_AGENT_NAME = '([^']*)';/);
    expect(m, "main/launch-directive-spawn.js › NEW_AGENT_NAME not found").toBeTruthy();
    expect(m![1]).toBe(NEW_AGENT_NAME);
  });
});
