/**
 * `20260930120000_credit_wallets.sql`, READ AS THE CONTRACT IT IS.
 *
 * ⚠ **THIS IS NOT A REPLAY.** Docker is unavailable on this machine, so nothing
 * here has met a database and nothing here claims to have. What a SQL-text test
 * can honestly prove is that the file still SAYS the things the rest of this
 * slice is built on — a per-payer key on each counter, the CAS shape that makes
 * the spend atomic, the INSERT-path limit guard, the service-role-only write
 * model, and that NOTHING IS DROPPED — each of which is a silent, expensive
 * failure if it drifts. Behavioural probes inside a rolled-back transaction (the
 * `20260827120000` precedent) are OWED and recorded as such.
 *
 * ⚠ Deploy state is a MEASUREMENT: `supabase migration list`, joined on the
 * NAME, never on the filename prefix (INVARIANTS §12, F-304).
 *
 * ⚠ **THE ONE THING A TEXT TEST CANNOT PROVE IS THE CONCURRENCY**, and that is
 * exactly what the CAS is for. What is pinned is that the statement SHAPE is
 * `consume_workspace_credits`'s — one `INSERT … ON CONFLICT DO UPDATE … WHERE …
 * RETURNING`, no advisory lock — because that shape is the argument
 * (`20260811130000`'s header carries it in full) and a second statement, a
 * `SELECT … FOR UPDATE` or a lock would each silently break it.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const MIGRATIONS = resolve(process.cwd(), "supabase", "migrations");
const NAME = "20260930120000_credit_wallets.sql";
const read = (f: string) => readFileSync(resolve(MIGRATIONS, f), "utf8");
const sql = read(NAME);

describe("the header carries what an operator needs before applying it", () => {
  it("says WRITTEN, NOT APPLIED — this directory's standing gate", () => {
    expect(sql).toContain("WRITTEN, NOT APPLIED");
  });

  it("tells the reader to re-derive by NAME, not by filename prefix (F-304)", () => {
    expect(sql).toContain("supabase migration list");
    expect(sql).toContain("JOIN ON THE\n-- NAME");
  });

  it("states the apply order and the two files it depends on", () => {
    const prose = sql.replace(/\n--\s*/g, " ");
    expect(prose).toContain("APPLY ORDER: LAST");
    expect(prose).toContain("20260920120000_workspace_kind_personal.sql");
    expect(prose).toContain("20260901130000_credit_usage_events.sql");
  });

  it("🔒 carries a COMPLETE rollback — every object this file creates", () => {
    const prose = sql.replace(/\n--\s*/g, " ");
    for (const stmt of [
      "DROP FUNCTION IF EXISTS public.consume_member_credits",
      "DROP FUNCTION IF EXISTS public.consume_user_credits",
      "DROP INDEX IF EXISTS public.credit_usage_events_payer_period_idx",
      "DROP COLUMN IF EXISTS payer_user_id",
      "DROP COLUMN IF EXISTS wallet",
      "DROP TABLE IF EXISTS public.workspace_member_credit_usage",
      "DROP TABLE IF EXISTS public.user_credit_usage",
    ]) {
      expect(prose, stmt).toContain(stmt);
    }
  });

  it("🔒 the rollback is PROSE, so applying the file cannot run it", () => {
    // Every DROP above lives behind a `--`. A live one here would delete the
    // counters this migration exists to create.
    const live = sql
      .split("\n")
      .filter((l) => !l.trimStart().startsWith("--"))
      .join("\n");
    expect(live).not.toMatch(/^\s*(DROP TABLE|DROP FUNCTION|DELETE|TRUNCATE)/im);
  });
});

describe("🔒 each counter is keyed on its PAYER — the whole point of the wave", () => {
  it("the personal wallet keys on (user, period)", () => {
    expect(sql).toMatch(
      /CREATE TABLE IF NOT EXISTS public\.user_credit_usage \([\s\S]*?PRIMARY KEY \(user_id, period_start\)/
    );
  });

  it("the seat wallet keys on (workspace, user, period)", () => {
    // ⚠ THE `user_id` IS THE REVERT DETECTOR. Drop it and this is
    // `workspace_credit_usage` again — one pooled row per workspace, which
    // cannot express a fixed per-member allocation (Samuel, 2026-09-07).
    expect(sql).toMatch(
      /CREATE TABLE IF NOT EXISTS public\.workspace_member_credit_usage \([\s\S]*?PRIMARY KEY \(workspace_id, user_id, period_start\)/
    );
  });

  it("both cascade from their owner rows, so a deleted account leaves no counter", () => {
    expect(sql).toContain("REFERENCES auth.users(id) ON DELETE CASCADE");
    expect(sql).toContain("REFERENCES public.workspaces(id) ON DELETE CASCADE");
  });
});

describe("🔒 RLS: no client may write, and a wallet is readable only by its owner", () => {
  it("enables RLS and revokes base DML on both tables", () => {
    for (const table of ["user_credit_usage", "workspace_member_credit_usage"]) {
      expect(sql, table).toContain(
        `ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY;`
      );
      expect(sql, table).toContain(
        `REVOKE INSERT, UPDATE, DELETE ON public.${table} FROM authenticated, anon;`
      );
    }
  });

  it("a personal wallet has a SELF-ONLY select policy and no member arm", () => {
    // 🔒 The counter spans the owner's whole home space, so a member arm would
    // show one container's peer the operator's spend across every OTHER
    // relationship they have.
    expect(sql).toMatch(
      /CREATE POLICY user_credit_usage_self_select ON public\.user_credit_usage\s+FOR SELECT\s+USING \(user_id = \(SELECT auth\.uid\(\)\)\);/
    );
    const policyBlock = sql.slice(
      sql.indexOf("CREATE POLICY user_credit_usage_self_select"),
      sql.indexOf("2. workspace_member_credit_usage")
    );
    expect(policyBlock).not.toContain("is_current_workspace_member");
  });

  it("a seat is readable by its holder OR a workspace ADMIN, through the caller-pinned helper", () => {
    expect(sql).toMatch(
      /CREATE POLICY workspace_member_credit_usage_select ON public\.workspace_member_credit_usage\s+FOR SELECT\s+USING \(\s*user_id = \(SELECT auth\.uid\(\)\)\s*OR is_current_workspace_member\(workspace_id, 'admin'::text\)\s*\);/
    );
  });

  it("🔒 the helper is the TWO-ARG caller-pinned form, never the 3-arg oracle", () => {
    // `20260720211005` M-9: the 3-arg `is_workspace_member(ws, user, role)` lets
    // a caller choose the subject and is revoked from `authenticated` for that
    // reason. Every policy asks the 2-arg form.
    expect(sql).not.toMatch(/is_workspace_member\(/);
    // And the signature this file uses is the one the tree defines.
    expect(read("20260720211005_rls_pin_workspace_member_and_initplan.sql")).toContain(
      "CREATE OR REPLACE FUNCTION public.is_current_workspace_member("
    );
  });

  it("uses the `(SELECT auth.uid())` initplan form, not a bare per-row call", () => {
    // A bare `auth.uid()` in a policy expression is re-evaluated PER ROW;
    // wrapping it hoists it to a once-per-query InitPlan (20260720211005 PART
    // 2). Count the wrapped occurrences against ALL of them rather than pattern
    // -matching the USING clause — every arm has to be wrapped, not just one.
    // ⚠ COMMENTS STRIPPED FIRST: this header discusses `auth.uid()` in prose,
    // and a scan that did not strip would pin a paragraph.
    const live = sql
      .split("\n")
      .map((l) => (l.indexOf("--") === -1 ? l : l.slice(0, l.indexOf("--"))))
      .join("\n");
    const all = live.match(/auth\.uid\(\)/g) ?? [];
    const wrapped = live.match(/\(SELECT auth\.uid\(\)\)/g) ?? [];
    expect(all.length).toBeGreaterThan(0);
    expect(wrapped.length).toBe(all.length);
  });
});

describe("🔒 the two RPCs copy consume_workspace_credits' exact CAS shape", () => {
  const bodies = {
    consume_user_credits: sql.slice(
      sql.indexOf("CREATE OR REPLACE FUNCTION public.consume_user_credits"),
      sql.indexOf("CREATE OR REPLACE FUNCTION public.consume_member_credits")
    ),
    consume_member_credits: sql.slice(
      sql.indexOf("CREATE OR REPLACE FUNCTION public.consume_member_credits"),
      sql.indexOf("-- Grants — service-role only")
    ),
  };

  for (const [name, body] of Object.entries(bodies)) {
    it(`${name} is ONE upsert-CAS statement with no advisory lock`, () => {
      expect(body).toContain("ON CONFLICT");
      expect(body).toContain("DO UPDATE");
      expect(body).toMatch(/WHERE u\.used \+ p_amount <= p_limit/);
      expect(body).toContain("RETURNING u.used INTO v_used");
      // ⚠ An advisory lock here would reproduce the leak through PgBouncer
      // transaction pooling that `20260720210814` records.
      expect(body).not.toContain("pg_advisory");
      expect(body).not.toMatch(/FOR UPDATE/);
    });

    it(`${name} guards the fresh-INSERT path too`, () => {
      // ⚠ THE `IF` IS NOT REDUNDANT. `ON CONFLICT … WHERE` guards only the
      // UPDATE, so without it a zero-limit wallet is granted its first call
      // free — and zero is now REACHABLE (an unmetered verdict resolves to it).
      expect(body).toMatch(/IF p_amount <= p_limit THEN/);
    });

    it(`${name} is SECURITY DEFINER with a pinned search_path`, () => {
      expect(body).toContain("SECURITY DEFINER");
      expect(body).toContain("SET search_path = public");
    });

    it(`${name} table-qualifies every column reference`, () => {
      // `used` is also an OUT parameter name; an unqualified one is an
      // ambiguous-reference error under plpgsql's default variable_conflict.
      expect(body).not.toMatch(/SET used = used/);
      expect(body).toMatch(/SET used = u\.used \+ p_amount/);
    });

    it(`${name} returns the counter AFTER the attempt, so a refusal renders used/limit`, () => {
      expect(body).toContain("RETURNS TABLE (allowed BOOLEAN, used INT)");
      expect(body).toMatch(/RETURN QUERY SELECT FALSE, COALESCE\(v_used, 0\);/);
    });
  }

  it("both are service-role only: REVOKE from PUBLIC/anon/authenticated, GRANT service_role", () => {
    for (const sig of [
      "public.consume_user_credits(UUID, TIMESTAMPTZ, INT, INT)",
      "public.consume_member_credits(UUID, UUID, TIMESTAMPTZ, INT, INT)",
    ]) {
      expect(sql, sig).toContain(
        `REVOKE ALL ON FUNCTION ${sig}\n  FROM PUBLIC, anon, authenticated;`
      );
      expect(sql, sig).toContain(
        `GRANT EXECUTE ON FUNCTION ${sig}\n  TO service_role;`
      );
    }
  });

  it("🔒 the limit is a PARAMETER — no allowance number is written into SQL", () => {
    // `credits.ts` is the one retune spot (`20260811130000`'s rule). A literal
    // here would make retuning a plan a migration.
    expect(sql).not.toMatch(/p_limit\s*(:?=)\s*\d/);
    expect(sql).not.toMatch(/\b(100|500|5000|5_000)\b\s*(INT|::int)/i);
  });
});

describe("the ledger gains the wallet dimension, additively", () => {
  it("adds `wallet` NOT NULL DEFAULT 'workspace' with its three-word CHECK", () => {
    expect(sql).toContain(
      "ADD COLUMN IF NOT EXISTS wallet TEXT NOT NULL DEFAULT 'workspace'"
    );
    expect(sql).toContain("CHECK (wallet IN ('workspace', 'personal', 'seat'))");
  });

  it("🔒 NOT NULL + DEFAULT is what makes it a NO-BACKFILL change in both directions", () => {
    // Existing rows take the default in place, and a rolled-back server that
    // inserts without naming a wallet writes what it meant.
    const prose = sql.replace(/\n--\s*/g, " ");
    expect(prose).toContain("NO-BACKFILL change in BOTH");
  });

  it("adds `payer_user_id` as SET NULL, never CASCADE — history outlives the account", () => {
    expect(sql).toContain(
      "ADD COLUMN IF NOT EXISTS payer_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL"
    );
  });

  it("covers the payer read AND the SET NULL scan with one index", () => {
    expect(sql).toContain(
      "CREATE INDEX IF NOT EXISTS credit_usage_events_payer_period_idx\n  ON public.credit_usage_events (payer_user_id, period_start);"
    );
  });

  it("re-COMMENTs `workspace_id`, whose MEANING changed under existing rows", () => {
    expect(sql).toContain("COMMENT ON COLUMN public.credit_usage_events.workspace_id");
    expect(sql).toContain("THE ADDRESSED CONTAINER");
  });
});

describe("🔒 the pooled counter is retired from writes and NOT dropped", () => {
  it("comments the table and the function as retired", () => {
    expect(sql).toContain("COMMENT ON TABLE public.workspace_credit_usage IS");
    expect(sql).toContain(
      "COMMENT ON FUNCTION public.consume_workspace_credits(UUID, TIMESTAMPTZ, INT, INT) IS"
    );
    expect(sql).toMatch(/RETIRED FROM WRITES 2026-09-07/);
  });

  it("drops neither — a rollback must find its counter with the balances it had", () => {
    expect(sql).not.toMatch(/DROP TABLE[^\n]*workspace_credit_usage/);
    const live = sql
      .split("\n")
      .filter((l) => !l.trimStart().startsWith("--"))
      .join("\n");
    expect(live).not.toContain("consume_workspace_credits(UUID, TIMESTAMPTZ, INT, INT);");
  });

  it("says in as many words that the COMMENT is not the fence", () => {
    // What actually stops a write is that no code path calls it — pinned in
    // `credits-service.test.ts`, not here. A file that claimed otherwise would
    // be teaching the next reader that a comment enforces something.
    const prose = sql.replace(/\n--\s*/g, " ");
    expect(prose).toContain("A COMMENT IS NOT A FENCE");
  });
});

describe("ordering", () => {
  it("sorts after every migration in the tree, and its version is unique", () => {
    const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql"));
    expect(files.filter((f) => f.startsWith("20260930120000"))).toEqual([NAME]);
    const later = files.filter((f) => f.slice(0, 14) > "20260930120000");
    // ⚠ Not a style rule: this file ALTERs `credit_usage_events` and reads the
    // `personal` workspace kind, so anything landing before it in filename
    // order is a replay failure, not a merge conflict.
    expect(later).toEqual([]);
  });
});
