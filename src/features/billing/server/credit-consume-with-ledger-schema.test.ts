/**
 * `20261004120000_credit_consume_with_ledger.sql`, READ AS THE CONTRACT IT IS.
 *
 * 🔒 **THE RULING IT ENCODES (Samuel, 2026-09-13): THE HISTOGRAM MUST EQUAL THE
 * WALLET, ALWAYS.** The counter UPDATE and the `credit_usage_events` INSERT are
 * one transaction, so a refused consume writes nothing and a failed ledger insert
 * rolls the counter back. Before this file the insert was a fire-and-forget
 * `console.warn` AFTER the counter had already committed, and a `42703` cost
 * Samuel's wallet three rows of attribution against a counter of 8 (F-693).
 *
 * ⚠ **NOT A REPLAY** — Docker is unavailable here, so nothing in this file has
 * met a database. What a SQL-text test can honestly prove is that the file still
 * SAYS what the fix is: ONE function per wallet, the ledger INSERT INSIDE the
 * branch the CAS already proved moved the counter, the CAS itself byte-for-byte
 * from `20260930120000` §3, no error handler anywhere near it, and the old
 * signatures dropped rather than left standing as overloads. Behavioural probes
 * are OWED (CI's `rls-redteam` job is the replay, INVARIANTS §14).
 *
 * ⚠ Deploy state is a MEASUREMENT: `supabase migration list`, joined on the
 * NAME, never on the filename prefix (INVARIANTS §12, F-304).
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const MIGRATIONS = resolve(process.cwd(), "supabase", "migrations");
const NAME = "20261004120000_credit_consume_with_ledger.sql";
const sql = readFileSync(resolve(MIGRATIONS, NAME), "utf8");
/** Header prose with the `--` line noise folded out, so a rule that wraps across
 *  two comment lines still reads as one sentence. */
const prose = sql.replace(/\n--\s*>?\s*/g, " ");
/** The statements only — what applying the file actually runs. */
const live = sql
  .split("\n")
  .filter((line) => !line.trimStart().startsWith("--"))
  .join("\n");

/** One function body, from its `CREATE` to the `$$;` that closes it. */
function body(name: string): string {
  const from = live.indexOf(`CREATE FUNCTION public.${name}(`);
  expect(from, `${name} is created`).toBeGreaterThan(-1);
  const end = live.indexOf("$$;", from);
  expect(end, `${name} is closed`).toBeGreaterThan(from);
  return live.slice(from, end);
}

describe("the header carries what an operator needs before applying it", () => {
  it("says WRITTEN, NOT APPLIED — this directory's standing gate", () => {
    expect(sql).toContain("WRITTEN, NOT APPLIED");
  });

  it("tells the reader to re-derive by NAME, not by filename prefix (F-304)", () => {
    expect(sql).toContain("supabase migration list");
    expect(prose).toContain("JOIN ON THE NAME");
  });

  it("states the apply order and the file it depends on", () => {
    expect(prose).toMatch(/APPLY ORDER:/);
    expect(prose).toContain("20261003120000");
  });

  it("🔒 carries SAMUEL'S RULING in the terms he stated it", () => {
    expect(prose).toContain("The histogram must equal the wallet, always");
    expect(prose).toContain("2026-09-13");
  });

  it("🔒 records the INCIDENT, including that the hand fix was not the fix", () => {
    // The measurement is the whole reason this file exists; a header that stated
    // only the rule would read as a refactor.
    expect(prose).toContain("used = 8");
    expect(prose).toContain("42703");
    expect(prose).toContain("that is not the fix");
  });

  it("says it is NOT additive and why an overload would be the same bug", () => {
    expect(prose).toContain("OVERLOAD");
    expect(prose).toMatch(/DEPLOY ORDER: THIS FILE FIRST, THE SERVER SECOND/);
  });

  it("carries a COMPLETE rollback, as PROSE, in the safe order", () => {
    for (const stmt of [
      "DROP FUNCTION IF EXISTS public.credit_ledger_sum(UUID, TEXT, TIMESTAMPTZ)",
      "DROP FUNCTION IF EXISTS public.consume_member_credits(UUID, UUID, TIMESTAMPTZ, INT, INT, UUID, UUID, UUID)",
      "DROP FUNCTION IF EXISTS public.consume_user_credits(UUID, TIMESTAMPTZ, INT, INT, UUID, UUID, UUID)",
    ]) {
      expect(prose, stmt).toContain(stmt);
    }
    // ⚠ The rollback must say to deploy the old server FIRST: between the two
    // steps every tool call is free, and discovering that afterwards is worse.
    expect(prose).toContain("DEPLOY THE PRE-WAVE SERVER FIRST");
    // Nothing in this file takes away a table, a column, an index or a policy.
    expect(live).not.toMatch(/DROP\s+(TABLE|COLUMN|INDEX|POLICY|CONSTRAINT)/i);
    expect(live).not.toMatch(/\b(TRUNCATE|DELETE\s+FROM)\b/i);
  });
});

describe("🔒 the old four/five-argument signatures are DROPPED, not replaced", () => {
  it("drops exactly the two signatures 20260930120000 created", () => {
    expect(live).toContain(
      "DROP FUNCTION IF EXISTS public.consume_user_credits(UUID, TIMESTAMPTZ, INT, INT);"
    );
    expect(live).toContain(
      "DROP FUNCTION IF EXISTS public.consume_member_credits(UUID, UUID, TIMESTAMPTZ, INT, INT);"
    );
  });

  /**
   * ⚠ **THE REVERT DETECTOR.** `CREATE OR REPLACE` on a CHANGED argument list
   * creates a SECOND function rather than replacing the first — and that second
   * function is the pre-fix path: a counter move with no ledger row, reachable by
   * any caller that sends the old argument names. The two consume functions must
   * therefore be plain `CREATE`.
   */
  it("creates both consume functions with bare CREATE, never OR REPLACE", () => {
    for (const name of ["consume_user_credits", "consume_member_credits"]) {
      expect(live, name).toContain(`CREATE FUNCTION public.${name}(`);
      expect(live, name).not.toContain(
        `CREATE OR REPLACE FUNCTION public.${name}(`
      );
    }
  });

  it("re-grants both, because a dropped function takes its grants with it", () => {
    for (const signature of [
      "public.consume_user_credits(UUID, TIMESTAMPTZ, INT, INT, UUID, UUID, UUID)",
      "public.consume_member_credits(UUID, UUID, TIMESTAMPTZ, INT, INT, UUID, UUID, UUID)",
      "public.credit_ledger_sum(UUID, TEXT, TIMESTAMPTZ)",
    ]) {
      expect(live, signature).toContain(
        `REVOKE ALL ON FUNCTION ${signature}\n  FROM PUBLIC, anon, authenticated;`
      );
      expect(live, signature).toContain(
        `GRANT EXECUTE ON FUNCTION ${signature}\n  TO service_role;`
      );
    }
  });
});

describe("🔒 ONE ATOMIC WRITE — the ledger INSERT is inside the CAS's success arm", () => {
  for (const [name, wallet, counter] of [
    ["consume_user_credits", "'personal'", "user_credit_usage"],
    ["consume_member_credits", "'seat'", "workspace_member_credit_usage"],
  ] as const) {
    describe(name, () => {
      const fn = () => body(name);

      it("takes the three ledger dimensions the counter's key cannot carry", () => {
        for (const arg of [
          "p_origin_workspace_id  UUID",
          "p_caller_user_id       UUID",
          "p_channel_id           UUID",
        ]) {
          expect(fn(), arg).toContain(arg);
        }
      });

      it("writes credit_usage_events with the wallet as a LITERAL", () => {
        // A wallet passed in is a wallet a caller can get wrong; this function
        // writes one counter, so the label is a fact about the function.
        expect(fn()).toContain("INSERT INTO credit_usage_events (");
        expect(fn()).toContain(wallet);
      });

      /**
       * 🔒 **THE ORDERING ASSERTION, AND IT IS THE WHOLE FILE.** The ledger
       * INSERT must sit AFTER `IF v_used IS NOT NULL THEN` — the CAS's own "the
       * counter moved" answer — and BEFORE that branch's `RETURN`. An insert
       * above the `IF` attributes credits a refusal never charged; one below the
       * `RETURN` is unreachable.
       */
      it("🔒 sits after `IF v_used IS NOT NULL THEN` and before its RETURN", () => {
        const text = fn();
        const guard = text.indexOf("IF v_used IS NOT NULL THEN");
        const insert = text.indexOf("INSERT INTO credit_usage_events (");
        const ret = text.indexOf("RETURN QUERY SELECT TRUE, v_used;");
        expect(guard).toBeGreaterThan(-1);
        expect(insert).toBeGreaterThan(guard);
        expect(ret).toBeGreaterThan(insert);
      });

      it("🔒 has NO exception handler — a failed insert must abort the spend", () => {
        // ⚠ THE SECOND REVERT DETECTOR. `EXCEPTION WHEN OTHERS THEN NULL` around
        // the insert would restore the exact defect in SQL: the counter commits,
        // the attribution does not, and nothing says so.
        expect(fn()).not.toMatch(/\bEXCEPTION\b/i);
      });

      it("keeps the CAS/allowance semantics byte-for-byte from 20260930120000 §3", () => {
        const text = fn();
        // Both insert paths guarded — the fresh INSERT by the `IF`, the UPDATE by
        // the ON CONFLICT predicate. A zero limit is reachable (an unmetered
        // verdict and a retired plan both resolve to one).
        expect(text).toContain("IF p_amount <= p_limit THEN");
        expect(text).toContain("WHERE u.used + p_amount <= p_limit");
        expect(text).toContain("SET used = u.used + p_amount, updated_at = now()");
        expect(text).toContain(`INSERT INTO ${counter} AS u (`);
        // The refusal still returns the CURRENT counter, so `used/limit` renders
        // without a second read.
        expect(text).toContain("RETURN QUERY SELECT FALSE, COALESCE(v_used, 0);");
        // SECURITY DEFINER with a pinned search_path — the counters have no
        // client write policy at all.
        expect(text).toContain("SECURITY DEFINER");
        expect(text).toContain("SET search_path = public");
      });

      it("🔒 does NOT copy the old writer's `amount > 0` guard", () => {
        // It existed to turn the table's own CHECK into a swallowed no-op. In one
        // transaction that CHECK is load-bearing: a bad amount refuses the whole
        // spend instead of skewing the ledger against the counter.
        expect(fn()).not.toMatch(/p_amount\s*>\s*0/);
        expect(prose).toContain("amount > 0` GUARD IS GONE");
      });
    });
  }

  it("🔒 writes the ADDRESSED container to both workspace columns, as the TS writer did", () => {
    // Column semantics are untouched by this file: `workspace_id` is the
    // addressed container and the CHARGED one is the counter's key. Moving that
    // meaning needs its own RLS argument.
    for (const name of ["consume_user_credits", "consume_member_credits"]) {
      expect(body(name), name).toContain(
        "p_origin_workspace_id, p_origin_workspace_id, p_caller_user_id, p_channel_id,"
      );
    }
  });
});

describe("credit_ledger_sum — the reconciliation guard's read side", () => {
  it("is keyed (payer, wallet, period) and narrows by NO workspace", () => {
    const fn = live.slice(
      live.indexOf("CREATE OR REPLACE FUNCTION public.credit_ledger_sum(")
    );
    expect(fn).toContain("e.payer_user_id = p_payer_user_id");
    expect(fn).toContain("e.wallet = p_wallet");
    expect(fn).toContain("e.period_start = p_period_start");
    // ⚠ The ledger row records the ADDRESSED container, not the charged one, so a
    // workspace narrowing would drop every cross-container seat burn and read as
    // drift.
    expect(fn.slice(0, fn.indexOf("$$;"))).not.toContain("workspace_id");
  });

  it("returns 0 rather than NULL for a wallet with no rows", () => {
    expect(live).toContain("COALESCE(SUM(e.amount), 0)::INT");
  });

  it("says WHY it is a function and not a PostgREST aggregate", () => {
    expect(prose).toContain("POSTGREST CANNOT AGGREGATE");
    expect(prose).toContain("a floor cannot measure a DIFFERENCE");
  });
});

describe("ordering", () => {
  it("has a unique version and sorts after every file it depends on", () => {
    const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql"));
    expect(files.filter((f) => f.startsWith("20261004120000"))).toEqual([NAME]);
    // ⚠ Not a style rule: this file's INSERT names `channel_id`, `wallet` and
    // `payer_user_id`, and it DROPs the two functions the wallets file created —
    // so all three must land BEFORE it in filename order or the replay fails.
    for (const dependency of [
      "20260901130000_credit_usage_events.sql",
      "20260930120000_credit_wallets.sql",
      "20261003120000_credit_events_channel.sql",
    ]) {
      expect(files).toContain(dependency);
      expect(dependency.slice(0, 14) < "20261004120000").toBe(true);
    }
  });
});
