/** `channel_sessions`' column privileges, read out of the migrations: no operator-only column is ever in
 *  a `GRANT SELECT (…)` list — the only guard on the PostgREST door `channel_sessions_member_select` opens. */

import { describe, it, expect } from "vitest";

import { readMigrations, statementAt } from "@/shared/supabase/migration-files";

/** Forward-renamed: `identity_name` was created as `template_name`. */
const FILES = readMigrations();
const ALL_SQL = FILES.map((f) => f.sql).join("\n");

function statementsMatching(re: RegExp, sql = ALL_SQL): string[] {
  const found: string[] = [];
  for (const m of sql.matchAll(re)) {
    if (m.index !== undefined) found.push(statementAt(sql, m.index));
  }
  return found;
}

/**
 * The belt, not the fence: app reads run on `supabaseAdmin()`, which bypasses RLS and column grants; the
 * fence is `server/collab-dto.ts › mapPeerSessionStateRow` (`server/session-visibility.test.ts`). The
 * grants guard a raw `GET /rest/v1/channel_sessions?select=*` by any channel member.
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

  /** Parallel to `collab-dto.ts › OPERATOR_ONLY_SESSION_COLUMNS`. The health columns' migration issues no
   *  grant, so their narrowing is an absence this scan keeps witnessing. */
  const OPERATOR_ONLY = [
    "tool_label",
    "model",
    "context_used",
    "context_window",
    "tokens_spent",
    "started_at",
    "last_activity_at",
    "identity_name",
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
    // A bare `REVOKE SELECT (cols)` is the opposite change.
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

  it("`identity_name` specifically — a private identity's name is an existence oracle", () => {
    // A private identity's name on a peer's card proves the row exists; names are not unique by design (INVARIANTS §5A).
    for (const stmt of grants) {
      expect(grantedColumns(stmt)).not.toContain("identity_name");
    }
    expect(ALL_SQL).toMatch(
      /ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+identity_name\s+TEXT/i
    );
  });

  it("`detail` IS granted — the one refinement that crosses to a peer", () => {
    // It crosses only because its vocabulary is closed; free-form, it becomes private.
    expect(grantedColumns(grants[grants.length - 1])).toContain("detail");
  });

  it("the columns RLS and the peer card depend on are granted", () => {
    // channel_id / workspace_id feed this table's own SELECT policy; the rest is the peer card.
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

  it("`identity_name` is nullable with no default, and carries the label CHECK", () => {
    const file = FILES.find((f) =>
      f.name.startsWith("20260823130000")
    );
    expect(file, "20260823130000_channel_sessions_template_name.sql is missing").toBeTruthy();
    // NULL says "no identity"; `NOT NULL` or `DEFAULT ''` would give every old row an identity named "".
    expect(file!.sql).not.toMatch(/identity_name\s+TEXT\s+NOT\s+NULL/i);
    expect(file!.sql).not.toMatch(/identity_name\s+TEXT\s+DEFAULT/i);
    // Not an FK: a session reports what it ran as after the identity is renamed or deleted.
    expect(file!.sql).not.toMatch(/identity_name[\s\S]{0,120}REFERENCES/i);
    // The four clauses `agent_identities_name_charset_check` carries, at the same
    // length — a name legal on an identity must never be refusable here.
    expect(file!.sql).toMatch(/char_length\(identity_name\)\s+BETWEEN\s+1\s+AND\s+120/i);
    expect(file!.sql).toMatch(/identity_name\s*=\s*btrim\(identity_name\)/i);
    expect(file!.sql).toMatch(/identity_name\s+!~\s+'\[\[:cntrl:\]\]'/i);
    // The assertion block, so a bad landing aborts rather than looking fine.
    expect(file!.sql).toMatch(/RAISE\s+EXCEPTION/i);
  });

  it("the HEALTH seven are undefaulted, and their migration ASSERTS its own absence", () => {
    const file = FILES.find((f) => f.name.startsWith("20260909120000"));
    expect(file, "20260909120000_channel_sessions_health.sql is missing").toBeTruthy();
    // NULL is unknown; `DEFAULT 0` would claim nothing was refused.
    for (const c of ["turns", "tokens_delta", "stale", "denied_calls", "last_wake_seq"]) {
      expect(file!.sql, `${c} must be nullable`).not.toMatch(
        new RegExp(`${c}\\s+(INTEGER|BIGINT|BOOLEAN|TEXT|TIMESTAMPTZ)\\s+(NOT NULL|DEFAULT)`, "i")
      );
    }
    // Its narrowing is an absence, so the file must grant nothing and its own check must RAISE.
    expect(
      file!.sql,
      "the file must GRANT nothing on channel_sessions — its narrowing IS the absence"
    ).not.toMatch(/\bGRANT\b[^;]*\bON\b[^;]*channel_sessions/i);
    // The anon arm, the authenticated arm and the RAISE that follows them, as ONE
    // statement — so a file that dropped either role still fails.
    expect(file!.sql).toMatch(
      /has_column_privilege\('authenticated',[^;]*OR\s+has_column_privilege\('anon',[\s\S]*?RAISE\s+EXCEPTION/i
    );
    // And service_role must keep the privilege, or every repository `select('*')` 42501s.
    expect(file!.sql).toMatch(
      /NOT\s+has_column_privilege\('service_role',[\s\S]*?RAISE\s+EXCEPTION/i
    );
  });
});
