/**
 * INVARIANT SUITE — `channel_sessions`' COLUMN PRIVILEGES, read out of
 * supabase/migrations. ⚠ **THE OPERATOR-ONLY COLUMNS ARE NEVER IN A
 * `GRANT SELECT (…)` LIST**, and the grant is the only thing enforcing that for
 * the PostgREST door `channel_sessions_member_select` opens.
 *
 * ⚠ SPLIT OUT OF `schema-sql.test.ts` ON 2026-09-01, when the agent-efficiency
 * wave's `20260909120000_channel_sessions_health` migration added SEVEN more
 * operator-only columns and pushed that file to 504 over the §1 cap of 500. The
 * seam is one TABLE's grants, which is also the unit that grows: every future
 * operator-only column lands here and nowhere else in this suite.
 *
 * ⚠ THE MIGRATION READERS ARE DUPLICATED FROM `schema-sql.test.ts`,
 * DELIBERATELY. They read the migration directory off disk and strip comments; a
 * shared module would be a `src/features/channels/` export existing only for
 * tests, and they are small, pure, and loudly broken by any change to the
 * directory's shape. ⚠ **THE PAIR THAT MUST NOT DRIFT IS `stripComments` /
 * `migrationFiles` / `statementAt` / `statementsMatching`** — a suite reading a
 * DIFFERENT set of statements than its sibling is the failure this note exists
 * to prevent, so change one and change the other. `finalPolicy` is NOT copied:
 * nothing here reads a policy, and an unused copy is a fifth thing to keep in
 * sync for no assertion's benefit.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const MIGRATIONS = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "supabase",
  "migrations"
);

/**
 * Strip `--` line comments without eating one inside a string literal or a
 * `$$…$$` body. ⚠ Hand scanner, not a regex — a regex is how a header's quoted
 * rollback SQL gets mistaken for a statement.
 */
function stripComments(sql: string): string {
  let out = "";
  let i = 0;
  let inSingle = false;
  let dollarTag: string | null = null;
  while (i < sql.length) {
    if (dollarTag) {
      if (sql.startsWith(dollarTag, i)) {
        out += dollarTag;
        i += dollarTag.length;
        dollarTag = null;
        continue;
      }
      out += sql[i++];
      continue;
    }
    if (inSingle) {
      if (sql[i] === "'") inSingle = false;
      out += sql[i++];
      continue;
    }
    if (sql[i] === "'") {
      inSingle = true;
      out += sql[i++];
      continue;
    }
    const dollar = /^\$[A-Za-z_]*\$/.exec(sql.slice(i, i + 40));
    if (dollar) {
      dollarTag = dollar[0];
      out += dollarTag;
      i += dollarTag.length;
      continue;
    }
    if (sql.startsWith("--", i)) {
      while (i < sql.length && sql[i] !== "\n") i++;
      continue;
    }
    out += sql[i++];
  }
  return out;
}

/** Every migration, filename-sorted (= apply order), comments removed. */
function migrationFiles(): Array<{ name: string; sql: string }> {
  return readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((name) => ({
      name,
      sql: stripComments(readFileSync(join(MIGRATIONS, name), "utf8")),
    }));
}

const FILES = migrationFiles();
const ALL_SQL = FILES.map((f) => f.sql).join("\n");

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

function statementsMatching(re: RegExp, sql = ALL_SQL): string[] {
  const found: string[] = [];
  for (const m of sql.matchAll(re)) {
    if (m.index !== undefined) found.push(statementAt(sql, m.index));
  }
  return found;
}

// ───────────────────────────────────────────────────────────────────────────
// 5. channel_sessions column privileges — the coarse projection is public,
//    telemetry and the TEMPLATE NAME are not
// ───────────────────────────────────────────────────────────────────────────

/**
 * THE BELT BEHIND THE DTO SPLIT (`20260822150000`, extended `20260823130000`).
 *
 * ⚠ **THIS IS NOT THE FENCE AND THE SUITE WILL NOT PRETEND IT IS.** Every
 * application read of `channel_sessions` runs on `supabaseAdmin()`
 * (service_role), which is not subject to RLS and keeps every column grant, so
 * these privileges cannot see the peer read at all. What stops an operator-only
 * field reaching a peer is `server/collab-dto.ts › mapPeerSessionStateRow`,
 * which CONSTRUCTS a narrow object, and `server/session-visibility.test.ts` is
 * the property test over it.
 *
 * What the belt IS for: the OTHER door. `channel_sessions_member_select`
 * (`20260820200000`) lets any channel member read any member's rows for that
 * channel, so a raw `GET /rest/v1/channel_sessions?select=*` would hand a peer
 * another operator's model, token spend — and, since 2026-08-23, the NAME OF A
 * TEMPLATE THAT MAY BE PRIVATE. Nothing in `src/` makes that call, and these
 * cases keep it that way by construction rather than by grep.
 */
describe("channel_sessions column privileges (operator-only stays operator-only)", () => {
  const grants = statementsMatching(
    /GRANT\s+SELECT\s*\([^)]*\)\s*\n?\s*ON\s+public\.channel_sessions\b/gi
  );

  function grantedColumns(stmt: string): string[] {
    const cols = /GRANT\s+SELECT\s*\(([^)]*)\)/i.exec(stmt);
    expect(cols, `no column list in: ${stmt}`).toBeTruthy();
    return cols![1]
      .split(",")
      .map((c) => c.trim())
      .filter(Boolean);
  }

  /**
   * ⚠ THE FIFTEEN, AS A LIST, AND IT MUST STAY PARALLEL TO
   * `collab-dto.ts › OPERATOR_ONLY_SESSION_COLUMNS`. A column classified PRIVATE
   * in one place and granted in the other is a fence with a hole and a green
   * suite — which is exactly the failure the DTO's two parallel arrays exist to
   * prevent on the application side.
   *
   * ⚠ **THE SEVEN HEALTH COLUMNS (2026-09-01, `20260909120000`) ARE HERE FOR A
   * REASON THIS BLOCK HAS NOT NEEDED BEFORE: THEIR MIGRATION ISSUES NO GRANT AT
   * ALL.** A column added by `ALTER TABLE` inherits nothing from an existing
   * column-privilege list, so all seven are service_role-only from birth — which
   * makes their narrowing an ABSENCE, and an absence is what silently stops being
   * true. The scan below is the standing witness: it fails the day ANY migration,
   * now or later, names one of them in a `GRANT SELECT (…)`.
   */
  const OPERATOR_ONLY = [
    "tool_label",
    "model",
    "context_used",
    "context_window",
    "tokens_spent",
    "started_at",
    "last_activity_at",
    "template_name",
    "turns",
    "tokens_delta",
    "stale",
    "denied_calls",
    "last_denied_tool",
    "last_wake_seq",
    "last_wake_at",
  ];

  it("the table-wide SELECT grant is revoked from anon and authenticated", () => {
    const revokes = statementsMatching(
      /REVOKE\s+SELECT\s+ON\s+public\.channel_sessions\b/gi
    );
    expect(revokes.length).toBeGreaterThan(0);
    const last = revokes[revokes.length - 1];
    expect(last).toMatch(/\banon\b/);
    expect(last).toMatch(/\bauthenticated\b/);
    // ⚠ A bare `REVOKE SELECT (cols)` is the opposite change.
    expect(last).not.toMatch(/REVOKE\s+SELECT\s*\(/i);
  });

  it("NO operator-only column is granted, in any migration, ever", () => {
    expect(grants.length).toBeGreaterThan(0);
    for (const stmt of grants) {
      const cols = grantedColumns(stmt);
      for (const priv of OPERATOR_ONLY) {
        expect(cols, `${priv} must never appear in a channel_sessions GRANT`).not.toContain(priv);
      }
    }
  });

  it("`template_name` specifically — a private template's name is an existence oracle", () => {
    // ⚠ Called out on its own line rather than left to the loop above, because
    // it is the ONE of the eight whose leak is not merely a privacy cost: a peer
    // seeing `Acme Contract Auditor` on a colleague's session learns that
    // `agent_templates` row exists, and that table carries NO name uniqueness
    // precisely so nothing can be probed that way (INVARIANTS §5A).
    for (const stmt of grants) {
      expect(grantedColumns(stmt)).not.toContain("template_name");
    }
    expect(ALL_SQL).toMatch(
      /ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+template_name\s+TEXT/i
    );
  });

  it("`detail` IS granted — the one refinement that crosses to a peer", () => {
    // ⚠ And it crosses ONLY because its vocabulary is closed and coarse
    // (`20260822150000`'s own stated condition). If it ever becomes free-form it
    // becomes PRIVATE in the same change, and this case is where that shows up.
    expect(grantedColumns(grants[grants.length - 1])).toContain("detail");
  });

  it("the columns RLS and the peer card depend on are granted", () => {
    // ⚠ channel_id / workspace_id are inputs to this table's OWN SELECT policy,
    // so revoking either makes the policy unevaluable rather than merely hiding
    // a field. user_id / state / updated_at are the peer card itself.
    const cols = grantedColumns(grants[grants.length - 1]);
    for (const c of ["channel_id", "workspace_id", "user_id", "state", "updated_at"]) {
      expect(cols, `${c} must stay readable`).toContain(c);
    }
  });

  it("nothing later hands the whole table back", () => {
    const tableWide = statementsMatching(
      /GRANT\s+SELECT\s+ON\s+public\.channel_sessions\b/gi
    );
    expect(tableWide.length).toBe(0);
  });

  it("`template_name` is nullable with no default, and carries the label CHECK", () => {
    const file = FILES.find((f) =>
      f.name.startsWith("20260823130000")
    );
    expect(file, "20260823130000_channel_sessions_template_name.sql is missing").toBeTruthy();
    // ⚠ NULLABLE AND UNDEFAULTED — "this session has no template" must be
    // sayable, and it is said as NULL. A NOT NULL or a `DEFAULT ''` would make
    // every pre-existing row claim a template named "".
    expect(file!.sql).not.toMatch(/template_name\s+TEXT\s+NOT\s+NULL/i);
    expect(file!.sql).not.toMatch(/template_name\s+TEXT\s+DEFAULT/i);
    // ⚠ SHAPE, NOT A REFERENCE. The column is deliberately NOT an FK: a session
    // reports what it RAN AS after the template is renamed or deleted.
    expect(file!.sql).not.toMatch(/template_name[\s\S]{0,120}REFERENCES/i);
    // The four clauses `agent_templates_name_charset_check` carries, at the same
    // length — a name legal on a template must never be refusable here.
    expect(file!.sql).toMatch(/char_length\(template_name\)\s+BETWEEN\s+1\s+AND\s+120/i);
    expect(file!.sql).toMatch(/template_name\s*=\s*btrim\(template_name\)/i);
    expect(file!.sql).toMatch(/template_name\s+!~\s+'\[\[:cntrl:\]\]'/i);
    // The assertion block, so a bad landing aborts rather than looking fine.
    expect(file!.sql).toMatch(/RAISE\s+EXCEPTION/i);
  });

  it("the HEALTH seven are undefaulted, and their migration ASSERTS its own absence", () => {
    const file = FILES.find((f) => f.name.startsWith("20260909120000"));
    expect(file, "20260909120000_channel_sessions_health.sql is missing").toBeTruthy();
    // ⚠ NULL IS UNKNOWN. A `DEFAULT 0` on `denied_calls` would make every row
    // from a desktop that counts nothing claim nothing was refused to it.
    for (const c of ["turns", "tokens_delta", "stale", "denied_calls", "last_wake_seq"]) {
      expect(file!.sql, `${c} must be nullable`).not.toMatch(
        new RegExp(`${c}\\s+(INTEGER|BIGINT|BOOLEAN|TEXT|TIMESTAMPTZ)\\s+(NOT NULL|DEFAULT)`, "i")
      );
    }
    // ⚠ ITS NARROWING IS AN ABSENCE — it issues no GRANT — so the migration has
    // to assert the absence rather than leave it to this scan alone.
    //
    // ⚠ **ASSERTED AS THE NEGATION, NOT AS THE PRESENCE OF A PHRASE (2026-09-02).**
    // These two lines used to be `toMatch(/has_column_privilege\('authenticated'/)`
    // and `toMatch(/RAISE\s+EXCEPTION/i)`, which every migration in this directory
    // satisfies and which a file that MENTIONED the check in a comment would pass
    // just as well. What matters is the shape: the file must GRANT nothing on this
    // table, and its privilege check must RAISE on the anon/authenticated arm.
    expect(
      file!.sql,
      "the file must GRANT nothing on channel_sessions — its narrowing IS the absence"
    ).not.toMatch(/\bGRANT\b[^;]*\bON\b[^;]*channel_sessions/i);
    // The anon arm, the authenticated arm and the RAISE that follows them, as ONE
    // statement — so a file that dropped either role still fails.
    expect(file!.sql).toMatch(
      /has_column_privilege\('authenticated',[^;]*OR\s+has_column_privilege\('anon',[\s\S]*?RAISE\s+EXCEPTION/i
    );
    // ⚠ AND THE POSITIVE HALF: service_role must KEEP the privilege, or every
    // `select('*')` in the repositories 42501s.
    expect(file!.sql).toMatch(
      /NOT\s+has_column_privilege\('service_role',[\s\S]*?RAISE\s+EXCEPTION/i
    );
  });
});
