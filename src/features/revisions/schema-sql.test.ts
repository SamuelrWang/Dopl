/**
 * INVARIANT SUITE — `revisions` as the migration set REPLAYED in apply order
 * leaves it. Database facts no application test can reach: every revision read
 * in this app runs on the SERVICE-ROLE client and never meets a policy.
 *
 * ⚠ **THE REPLAY IS THE SHARED MODULE** (`knowledge/migration-replay.ts`) — a
 * second copy of "how to replay a migration set" is how two suites come to
 * disagree about what the final state IS. It reads files in FILENAME order,
 * which is apply order, and a `DROP` in a later file is as load-bearing as the
 * `CREATE`.
 *
 * ⚠ **THE TWO CLOSED SETS ARE PINNED IN BOTH DIRECTIONS** — `types.ts ›
 * REVISION_OPS` / `› REVISION_RESOURCE_TYPES` against the table's `CHECK`s.
 * Drift is silent in both directions: an op the CHECK lacks throws `23514` only
 * on a real INSERT, and an op the union lacks is cast into it and takes every
 * default branch. Same shape as `channels/message-kind-drift.test.ts`, held here
 * as a test rather than as a CI gate because both halves live in `src/`.
 *
 * ⚠ MUTATION-VERIFIED — each turns an assertion below red: adding a second
 * SELECT policy; giving the table a write policy; making
 * `dopl_revision_readable` restate a knowledge visibility rule instead of
 * calling `dopl_knowledge_base_readable`; dropping `SECURITY DEFINER`; adding
 * `revisions` to `supabase_realtime`; removing an op from the CHECK.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  livePolicies,
  liveFunctionBody,
  liveFunctionHeader,
  tableIsLive,
} from "@/features/knowledge/migration-replay";
import { REVISION_OPS, REVISION_RESOURCE_TYPES } from "./types";

const MIGRATION = join(
  process.cwd(),
  "supabase/migrations/20261002120000_revisions.sql"
);
const SQL = readFileSync(MIGRATION, "utf8");
const POLICIES = livePolicies("revisions");

describe("revisions — the replayed table", () => {
  it("the table is live and carries policies (an empty scan must not pass silently)", () => {
    expect(tableIsLive("revisions")).toBe(true);
    expect(POLICIES.size).toBeGreaterThan(0);
  });

  it("🔒 has EXACTLY ONE live SELECT policy — permissive policies are OR-ed", () => {
    const selects = [...POLICIES].filter(([, body]) => /\bFOR\s+SELECT\b/i.test(body));
    expect(selects.map(([name]) => name)).toEqual(["revisions_member_select"]);
  });

  it("🔒 has NO write policy at all — the audit log has one writer, the service role", () => {
    const writes = [...POLICIES].filter(([, body]) => !/\bFOR\s+SELECT\b/i.test(body));
    expect(writes.map(([name]) => name)).toEqual([]);
  });

  it("🔒 revokes INSERT/UPDATE/DELETE from the login roles", () => {
    expect(SQL).toMatch(
      /REVOKE\s+INSERT,\s*UPDATE,\s*DELETE\s+ON\s+public\.revisions\s+FROM\s+authenticated,\s*anon/i
    );
  });

  it("🔒 the SELECT policy DEFERS — it states no rule of its own", () => {
    const body = POLICIES.get("revisions_member_select");
    expect(body).toBeTruthy();
    expect(body).toMatch(
      /USING\s*\(\s*public\.dopl_revision_readable\(\s*resource_type\s*,\s*resource_id\s*\)\s*\)/i
    );
    // A visibility rule restated here would be a second answer to a question
    // `dopl_knowledge_base_readable` already answers.
    expect(body).not.toMatch(/knowledge_bases|workspace_members|visibility/i);
    expect(body).not.toMatch(/USING\s*\(\s*true\s*\)/i);
  });
});

describe("dopl_revision_readable — the CASE that defers", () => {
  const BODY = liveFunctionBody("dopl_revision_readable");
  const HEADER = liveFunctionHeader("dopl_revision_readable");

  it("exists after replay", () => {
    expect(BODY).toBeTruthy();
  });

  it("🔒 is SECURITY DEFINER and STABLE", () => {
    expect(HEADER).toMatch(/SECURITY\s+DEFINER/i);
    expect(HEADER).toMatch(/\bSTABLE\b/i);
  });

  it("🔒 takes NO caller-supplied subject, so `authenticated` may hold EXECUTE", () => {
    expect(HEADER).not.toMatch(/p_user_id/i);
    expect(SQL).toMatch(
      /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.dopl_revision_readable\(text,\s*uuid\)/i
    );
    expect(SQL).toMatch(
      /REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.dopl_revision_readable\(text,\s*uuid\)\s+FROM\s+PUBLIC,\s*anon/i
    );
  });

  it("🔒 defers to BOTH resource families' own predicates", () => {
    expect(BODY).toContain("dopl_knowledge_base_readable");
    expect(BODY).toContain("dopl_ontology_readable");
    expect(BODY).toContain("dopl_ontology_object_clusters");
  });

  it("🔒 has an arm for EVERY resource type the CHECK admits", () => {
    for (const type of REVISION_RESOURCE_TYPES) {
      expect(BODY, type).toContain(`WHEN '${type}'`);
    }
  });

  it("🔒 an unrecognised resource type admits nobody", () => {
    expect(BODY).toMatch(/ELSE\s+false/i);
  });
});

describe("the closed sets, pinned against the CHECKs", () => {
  function checkValues(column: string): string[] {
    const m = new RegExp(
      `${column}\\s+TEXT\\s+NOT\\s+NULL\\s+CHECK\\s*\\(\\s*${column}\\s+IN([\\s\\S]*?)\\)\\s*,`,
      "i"
    ).exec(SQL);
    expect(m, `no CHECK found for ${column}`).toBeTruthy();
    return [...m![1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
  }

  it("`op` — the TS union EQUALS the CHECK, in both directions", () => {
    expect([...checkValues("op")].sort()).toEqual([...REVISION_OPS].sort());
  });

  it("`resource_type` — the TS union EQUALS the CHECK, in both directions", () => {
    expect([...checkValues("resource_type")].sort()).toEqual(
      [...REVISION_RESOURCE_TYPES].sort()
    );
  });

  it("`actor_kind` is the two-value set the actor model states", () => {
    expect(checkValues("actor_kind").sort()).toEqual(["agent", "user"]);
  });
});

describe("the shape the reads depend on", () => {
  it("files the row under the RESOURCE's container, cascading with it", () => {
    expect(SQL).toMatch(
      /workspace_id\s+UUID\s+NOT\s+NULL\s+REFERENCES\s+public\.workspaces\(id\)\s+ON\s+DELETE\s+CASCADE/i
    );
  });

  it("🔒 the row SURVIVES its author — a deleted account takes no history with it", () => {
    expect(SQL).toMatch(
      /actor_user_id\s+UUID\s+REFERENCES\s+auth\.users\(id\)\s+ON\s+DELETE\s+SET\s+NULL/i
    );
  });

  it("carries both named indexes the two reads plan against", () => {
    expect(SQL).toMatch(
      /CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+revisions_resource_idx[\s\S]*?\(resource_type,\s*resource_id,\s*created_at\s+DESC\)/i
    );
    expect(SQL).toMatch(
      /CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+revisions_workspace_idx[\s\S]*?\(workspace_id,\s*created_at\s+DESC\)/i
    );
  });

  it("🔒 `updated_at` exists — the coalescing window has a column to write", () => {
    expect(SQL).toMatch(/updated_at\s+TIMESTAMPTZ\s+NOT\s+NULL\s+DEFAULT\s+now\(\)/i);
  });

  it("⚠ NOT a realtime change, and the migration ASSERTS the absence", () => {
    expect(SQL).not.toMatch(/ALTER\s+PUBLICATION\s+supabase_realtime\s+ADD\s+TABLE\s+public\.revisions/i);
    expect(SQL).toMatch(/joined supabase_realtime/);
  });

  it("carries the house header: written-not-applied, apply BY NAME, apply order, rollback prose", () => {
    expect(SQL).toMatch(/WRITTEN, NOT APPLIED/);
    expect(SQL).toMatch(/APPLY IT BY NAME \(`revisions`\)/);
    expect(SQL).toMatch(/APPLY ORDER: IMMEDIATELY AFTER `ontology_readable`/);
    expect(SQL).toMatch(/ROLLBACK — PROSE, NOT COMMENTED-OUT SQL/);
    expect(SQL).toMatch(/DO \$\$/);
  });
});
