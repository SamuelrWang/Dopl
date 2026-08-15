/**
 * INVARIANT SUITE — the channels SCHEMA, read out of supabase/migrations. These
 * are database facts no application test can reach:
 *
 *   1. ⚠ NO CHANNEL-SCOPED SELECT POLICY MAY FORGET `deleted_at` — without it a
 *      "permanently deleted" channel serves its whole transcript to its former
 *      members over direct PostgREST.
 *   2. ⚠ NOTHING MAY HARD-DELETE A DIRECT CHANNEL. A tombstoned DM is the CLOSE
 *      half of close/reopen — live product state. Every `DELETE FROM channels`
 *      must carry the `is_direct = false` guard, and `20260807110000` must keep
 *      excluding channels entirely.
 *   3. The purge's one `DELETE` is atomic-and-complete only because all six
 *      child FKs into `channels` are `ON DELETE CASCADE`.
 *   4. ⚠ `role` is PUBLIC, `agent_tool_profile` is NOT. The column grant is the
 *      only thing enforcing that for PostgREST *and* CDC; a future
 *      `GRANT SELECT ON channel_members` silently undoes it.
 *
 * ⚠ Comments are STRIPPED before matching — migration headers quote SQL at
 * length (rollback blocks, verification SELECTs) and a naive scan pins a
 * comment.
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

/** The LAST `CREATE POLICY <name>` in apply order — what the DB ends up with. */
function finalPolicy(name: string): string {
  const stmts = statementsMatching(
    new RegExp(`CREATE POLICY\\s+${name}\\b`, "g")
  );
  expect(stmts.length, `no CREATE POLICY ${name} found in supabase/migrations`)
    .toBeGreaterThan(0);
  return stmts[stmts.length - 1];
}

// ───────────────────────────────────────────────────────────────────────────
// 1. deleted_at IS NULL on every channel-transparent SELECT policy
// ───────────────────────────────────────────────────────────────────────────

/**
 * The five policies meaning "you may read this because you are in channel X, or
 * X is public". ⚠ Each must also require the channel ALIVE, or a tombstone keeps
 * serving its rows. `channel_consent_requests` / `channel_sessions` are
 * deliberately absent — OWNER-scoped, not a shared transcript.
 */
const CHANNEL_TRANSPARENT_SELECT_POLICIES = [
  "channels_member_select",
  "channel_members_member_select",
  "channel_messages_member_select",
  "channel_tasks_member_select",
  "channel_agents_member_select",
];

describe("channel-scoped RLS hides tombstoned channels (C-15)", () => {
  it.each(CHANNEL_TRANSPARENT_SELECT_POLICIES)(
    "%s requires deleted_at IS NULL",
    (policy) => {
      expect(finalPolicy(policy)).toMatch(/deleted_at\s+IS\s+NULL/i);
    }
  );

  it("still fences on the workspace and on membership — the guard is ADDED, not swapped in", () => {
    for (const policy of CHANNEL_TRANSPARENT_SELECT_POLICIES) {
      const sql = finalPolicy(policy);
      expect(sql, policy).toMatch(/is_current_workspace_member\(/);
      expect(sql, policy).toMatch(/is_channel_member\(/);
    }
  });

  it("uses no policy helper beyond is_channel_member (a new one owes anon EXECUTE)", () => {
    // ⚠ Any NEW function referenced by a SELECT policy on a PUBLISHED table must
    // also be GRANTed to anon, or an expired-JWT subscriber joining as anon
    // raises 42501 inside realtime.apply_rls and kills CDC for the whole
    // project. Inline EXISTS has no such footgun.
    const KNOWN = new Set(["is_current_workspace_member", "is_channel_member"]);
    for (const policy of CHANNEL_TRANSPARENT_SELECT_POLICIES) {
      const sql = finalPolicy(policy);
      const calls = [...sql.matchAll(/\b(is_[a-z_]+)\s*\(/g)].map((m) => m[1]);
      for (const fn of calls) expect(KNOWN.has(fn), `${policy} calls ${fn}`).toBe(true);
    }
  });

  it("channel_task_participants inherits the guard through channel_tasks", () => {
    // ⚠ No own deleted_at conjunct on purpose — its EXISTS is on channel_tasks,
    // itself RLS-filtered for the same caller. Lose that reference and the
    // inheritance argument goes with it.
    const sql = finalPolicy("channel_task_participants_member_select");
    expect(sql).toMatch(/FROM\s+public\.channel_tasks/i);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 2. A DM is never hard-deleted
// ───────────────────────────────────────────────────────────────────────────

describe("no migration may hard-delete a direct channel (C-16, ENGINEERING §7)", () => {
  const deletes = statementsMatching(
    /DELETE\s+FROM\s+(?:ONLY\s+)?(?:public\.)?channels\b/gi
  );

  it("finds the one-time purge and nothing else deleting from channels", () => {
    expect(deletes.length).toBe(1);
  });

  it("the purge is guarded on is_direct = false and on deleted_at", () => {
    const sql = deletes[0];
    expect(sql).toMatch(/deleted_at\s+IS\s+NOT\s+NULL/i);
    expect(sql).toMatch(/is_direct\s*=\s*false/i);
  });

  it("the purge never names is_direct = true", () => {
    expect(deletes[0]).not.toMatch(/is_direct\s*=\s*true/i);
  });

  it("every channels DELETE, now and later, carries the is_direct = false guard", () => {
    for (const sql of deletes) expect(sql).toMatch(/is_direct\s*=\s*false/i);
  });

  it("20260807110000 still excludes channels from the original tombstone sweep", () => {
    const file = FILES.find((f) => f.name.startsWith("20260807110000"));
    expect(file, "20260807110000_purge_soft_deleted_rows.sql is missing").toBeTruthy();
    expect(file!.sql).not.toMatch(/DELETE\s+FROM\s+(?:public\.)?channels\b/i);
  });

  it("the purge aborts if the closed-DM count moves (the guard is executable, not prose)", () => {
    const file = FILES.find((f) => f.name.startsWith("20260810110000"));
    expect(file, "the purge migration is missing").toBeTruthy();
    expect(file!.sql).toMatch(/RAISE\s+EXCEPTION/i);
    expect(file!.sql).toMatch(/is_direct\s*=\s*true/i); // the before/after count
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 3. The cascade the purge relies on
// ───────────────────────────────────────────────────────────────────────────

describe("every FK into channels is ON DELETE CASCADE (what makes one DELETE complete)", () => {
  const refs = [
    ...ALL_SQL.matchAll(
      /REFERENCES\s+(?:public\.)?channels\s*\(\s*id\s*\)([^,\n]*)/gi
    ),
  ];

  it("finds all six child FKs", () => {
    expect(refs.length).toBe(6);
  });

  it("each one cascades — none is SET NULL or RESTRICT", () => {
    for (const m of refs) {
      expect(m[1], `REFERENCES channels(id)${m[1]}`).toMatch(/ON DELETE CASCADE/i);
    }
  });

  it("channel_task_participants cascades from channel_tasks (the transitive hop)", () => {
    expect(ALL_SQL).toMatch(
      /REFERENCES\s+public\.channel_tasks\s*\(\s*id\s*\)\s+ON DELETE CASCADE/i
    );
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 4. channel_members column privileges — role public, settings private
// ───────────────────────────────────────────────────────────────────────────

describe("channel_members column privileges (Samuel 2026-08-10: role yes, permissions no)", () => {
  const grants = statementsMatching(
    /GRANT\s+SELECT\s*\([^)]*\)\s*\n?\s*ON\s+public\.channel_members\b/gi
  );

  function grantedColumns(stmt: string): string[] {
    const cols = /GRANT\s+SELECT\s*\(([^)]*)\)/i.exec(stmt);
    expect(cols, `no column list in: ${stmt}`).toBeTruthy();
    return cols![1]
      .split(",")
      .map((c) => c.trim())
      .filter(Boolean);
  }

  it("the table-wide SELECT grant is revoked from anon and authenticated", () => {
    const revokes = statementsMatching(
      /REVOKE\s+SELECT\s+ON\s+public\.channel_members\b/gi
    );
    expect(revokes.length).toBeGreaterThan(0);
    const last = revokes[revokes.length - 1];
    expect(last).toMatch(/\banon\b/);
    expect(last).toMatch(/\bauthenticated\b/);
    // ⚠ A bare `REVOKE SELECT (cols)` is the opposite change.
    expect(last).not.toMatch(/REVOKE\s+SELECT\s*\(/i);
  });

  it("role is granted — it is the one thing Samuel named as public", () => {
    expect(grants.length).toBeGreaterThan(0);
    expect(grantedColumns(grants[grants.length - 1])).toContain("role");
  });

  it("agent_tool_profile is NOT granted — the containment setting stays private", () => {
    for (const stmt of grants) {
      expect(grantedColumns(stmt)).not.toContain("agent_tool_profile");
    }
  });

  it("the columns RLS and the realtime filter depend on are granted", () => {
    // ⚠ workspace_id is the subscription filter on both subscribers AND the
    // policy's outer fence; channel_id is the policy's other input. Revoking
    // either breaks the FEED, not just a payload field.
    const cols = grantedColumns(grants[grants.length - 1]);
    for (const c of ["channel_id", "user_id", "workspace_id"]) {
      expect(cols, `${c} must stay readable`).toContain(c);
    }
  });

  it("nothing later hands the whole table back", () => {
    // ⚠ If the header's rollback (`GRANT SELECT ON public.channel_members TO
    // anon, authenticated`) ever lands as a statement, this invariant is gone
    // and the DTO scrub is alone.
    const tableWide = statementsMatching(
      /GRANT\s+SELECT\s+ON\s+public\.channel_members\b/gi
    );
    expect(tableWide.length).toBe(0);
  });
});
