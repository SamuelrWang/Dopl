/**
 * `20261008120000_artifact_spans_rpc.sql`, READ AS THE CONTRACT IT IS (F-712).
 *
 * ⚠ **THIS IS NOT A REPLAY.** Docker is unavailable on this machine, so nothing
 * here has met a database and nothing here claims to have — the
 * `billing/server/credit-wallets-schema.test.ts` posture, for its reason.
 * Behavioural probes inside a rolled-back transaction (the `20260827120000`
 * precedent) are OWED and recorded as such. What a SQL-text test can honestly
 * prove is that the file still SAYS the things the repository is built on, each
 * of which is a silent, expensive failure if it drifts:
 *
 *   1. **`SECURITY INVOKER`, never DEFINER.** A `CREATE OR REPLACE` that flipped
 *      it would keep the name, the signature and the grants, and open a second
 *      door into `channel_messages` that never consults RLS.
 *   2. **The grants are stated in the file that creates the function** — the
 *      whole reason `20260619040000_security_hardening_rpc_grants.sql` exists.
 *   3. **The FENCE is in the SQL**, not only in the caller: the grouping filters
 *      on `p_channel_id`, so a repository that stopped passing it would narrow
 *      nothing rather than widen silently.
 *   4. **The repository and the function agree on the NAME and the ARGUMENT
 *      NAMES.** PostgREST resolves an RPC by both, so a rename on either side is
 *      a `PGRST202` at runtime and nothing at compile time — the admin client is
 *      untyped (`SupabaseClient` with no `Database` generic).
 *
 * ⚠ Deploy state is a MEASUREMENT: `supabase migration list`, joined on the
 * NAME (`artifact_spans_rpc`), never on the filename prefix (INVARIANTS §12,
 * F-304).
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const NAME = "20261008120000_artifact_spans_rpc.sql";
const sql = readFileSync(
  resolve(process.cwd(), "supabase", "migrations", NAME),
  "utf8"
);
const repository = readFileSync(
  resolve(process.cwd(), "src/features/channels/server/repository-artifacts.ts"),
  "utf8"
);

/**
 * Comments stripped — this header quotes its own SQL, its rollback and its
 * grants at length, and a scan that did not strip them would pin prose.
 *
 * ⚠ **STRING LITERALS ARE STRIPPED TOO, NOT JUST `--` LINES** — the
 * `shared/supabase/migrations-held.test.ts` rule, and this file is exactly why:
 * the verification block RAISEs a message containing the words "SECURITY
 * DEFINER", which is an assertion ABOUT the property, not the property. A scan
 * that kept it would read the guard as the thing it guards against.
 */
const statements = sql
  .split("\n")
  .map((line) => (line.trimStart().startsWith("--") ? "" : line))
  .join("\n");
const body = statements.replace(/'(?:[^']|'')*'/g, "''");

describe("the header carries what an operator needs before applying it", () => {
  it("says WRITTEN, NOT APPLIED — this directory's standing gate", () => {
    expect(sql).toContain("WRITTEN, NOT APPLIED");
  });

  it("tells the operator to apply it BY NAME, byte-exact, never by db push", () => {
    expect(sql).toContain("artifact_spans_rpc");
    expect(sql).toContain("supabase migration list");
    expect(sql).toMatch(/NEVER WITH `db push`/i);
  });

  it("states the rollback, and that the repository reverts with it", () => {
    expect(sql).toContain("DROP FUNCTION public.channel_artifact_spans(uuid, uuid[]);");
    expect(sql).toContain("PGRST202");
  });
});

describe("channel_artifact_spans — the function", () => {
  it("is created with both arguments, the channel first", () => {
    expect(body).toMatch(
      /CREATE OR REPLACE FUNCTION public\.channel_artifact_spans\(\s*p_channel_id uuid,\s*p_artifact_ids uuid\[\]\s*\)/
    );
  });

  it("returns one row per artifact: id, count, first_seq, last_seq", () => {
    expect(body).toMatch(
      /RETURNS TABLE \(artifact_id uuid, count bigint, first_seq bigint, last_seq bigint\)/
    );
  });

  /** 🔒 THE ONE PROPERTY A NAME CHECK CANNOT SEE — and the migration's own
   *  `DO $$` asserts `prosecdef` is false at apply time, which is the half a
   *  text test cannot do. */
  it("🔒 is SECURITY INVOKER and nowhere says DEFINER", () => {
    expect(body).toContain("SECURITY INVOKER");
    expect(body).not.toMatch(/SECURITY\s+DEFINER/i);
  });

  it("pins a non-mutable search_path — the advisor's standing rule", () => {
    expect(body).toContain("SET search_path = public, pg_temp");
  });

  it("is STABLE — it is a read and must never be treated as a write", () => {
    expect(body).toMatch(/\bSTABLE\b/);
  });

  /** 🔒 THE FENCE IS IN THE STATEMENT. `.eq("channel_id", …)` was the whole
   *  authorization of the read this replaces; an aggregate that grouped by
   *  artifact id alone would count across rooms. */
  it("🔒 filters on the channel AND the ids, and groups by artifact", () => {
    expect(body).toContain("WHERE m.channel_id = p_channel_id");
    expect(body).toContain("AND m.artifact_id = ANY (p_artifact_ids)");
    expect(body).toContain("GROUP BY m.artifact_id");
  });

  it("aggregates in Postgres — count, min and max, over channel_messages", () => {
    expect(body).toMatch(/count\(\*\)/);
    expect(body).toMatch(/min\(m\.seq\)/);
    expect(body).toMatch(/max\(m\.seq\)/);
    expect(body).toContain("FROM public.channel_messages m");
  });
});

describe("the grants — service_role only", () => {
  it("revokes from PUBLIC, anon and authenticated", () => {
    for (const role of ["PUBLIC", "anon", "authenticated"]) {
      expect(body).toContain(
        `REVOKE ALL ON FUNCTION public.channel_artifact_spans(uuid, uuid[]) FROM ${role};`
      );
    }
  });

  it("grants EXECUTE to service_role and to nothing else", () => {
    expect(body).toContain(
      "GRANT EXECUTE ON FUNCTION public.channel_artifact_spans(uuid, uuid[]) TO service_role;"
    );
    const grants = [...body.matchAll(/GRANT\s+EXECUTE[^;]+;/gi)].map((m) => m[0]);
    expect(grants).toHaveLength(1);
    expect(grants[0]).not.toMatch(/\bauthenticated\b|\banon\b/);
  });

  it("asserts the grants at apply time instead of trusting them", () => {
    expect(sql).toContain("has_function_privilege('anon'");
    expect(sql).toContain("has_function_privilege('service_role'");
    expect(sql).toContain("prosecdef");
  });
});

/**
 * 🔒 **THE FENCE THIS FUNCTION INHERITS, AND THE ASSERTION THAT GOT IT WRONG
 * ONCE.** The first draft aborted the apply on
 * `has_table_privilege('authenticated', 'public.channel_messages', 'SELECT')` —
 * reading this table as `channel_artifacts`-shaped (deny-by-default, service-role
 * only). **`channel_messages` is not that shape**:
 * `20260725130000_channels_rls_hardening.sql` revokes only INSERT/UPDATE/DELETE
 * and says the `*_member_select` policies "carry the direct-read model for
 * Realtime and RLS reads", so SELECT stays GRANTED and
 * `channel_messages_member_select` decides the rows. The real apply aborted on a
 * correct database, which is the expensive direction for a tripwire to be wrong
 * in: it blocks a correct change while reading as vigilance.
 */
describe("the read fence it inherits is asserted against the RIGHT model", () => {
  // ⚠ THESE READ `statements`, NOT `body`: the predicates they pin ARE string
  // literals (`relname = 'channel_messages'`, `cmd = 'SELECT'`), and `body`
  // exists to strip literals. Stripping here would blank the assertion itself.
  it("🔒 checks ROW SECURITY is enabled on channel_messages", () => {
    expect(statements).toContain("relrowsecurity");
    expect(statements).toMatch(
      /relname = 'channel_messages'|tablename = 'channel_messages'/
    );
  });

  it("🔒 checks at least one FOR SELECT policy is live on it", () => {
    expect(statements).toMatch(/FROM pg_policies[\s\S]*cmd = 'SELECT'/);
  });

  it("⚠ does NOT assert a table GRANT — that is the other table's model", () => {
    expect(statements).not.toMatch(/has_table_privilege/);
  });
});

describe("what this migration is NOT", () => {
  /** ⚠ It creates no table, no column, no policy, no index and no publication
   *  membership — so it is not a realtime change (INVARIANTS §7) and the RLS
   *  pair gate has nothing to learn from it. A file that grew one of these
   *  would need §7 read first and a COVERED entry second. */
  it("adds no table, column, policy or index", () => {
    expect(body).not.toMatch(/CREATE\s+(TABLE|POLICY|INDEX)/i);
    expect(body).not.toMatch(/ALTER\s+TABLE/i);
    expect(body).not.toMatch(/ADD\s+COLUMN/i);
  });

  it("drops nothing — the rollback is prose in the header, not a statement", () => {
    expect(body).not.toMatch(/DROP\s+(TABLE|POLICY|INDEX|COLUMN|FUNCTION)/i);
  });

  it("⚠ adds no index: the grouping is `channel_messages_artifact_idx`'s shape", () => {
    expect(sql).toContain("channel_messages_artifact_idx");
    expect(body).not.toMatch(/CREATE\s+INDEX/i);
  });
});

describe("the repository and the function agree", () => {
  it("🔒 calls it by the name the migration creates", () => {
    expect(repository).toContain('.rpc("channel_artifact_spans"');
  });

  it("🔒 passes the argument names PostgREST will resolve it by", () => {
    expect(repository).toContain("p_channel_id: channelId");
    expect(repository).toContain("p_artifact_ids: artifactIds");
  });

  /** ⚠ THE JS FOLD IS GONE. A repository that still selected the member rows
   *  would have kept the clipped page this finding is about, whatever the RPC
   *  answered. */
  it("⚠ no longer selects the member rows to count them", () => {
    expect(repository).not.toContain('.select("artifact_id, seq")');
  });

  it("cites the migration, so an operator reading either end finds the other", () => {
    expect(repository).toContain(NAME);
  });
});
