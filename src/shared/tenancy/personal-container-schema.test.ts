/**
 * `20260920120000_workspace_kind_personal.sql`, READ AS THE CONTRACT IT IS.
 *
 * ⚠ **THIS IS NOT A REPLAY.** Docker has been down for all of wave A and wave B
 * batch 1, so nothing here has met a database and nothing here claims to have.
 * What a SQL-text test can honestly prove is that the file still SAYS the four
 * things the rest of this slice is built on — one container per user, an owner
 * membership on it, the shelf moved by AUTHOR, and no destructive statement —
 * each of which is a silent, unrecoverable failure if it drifts. The behavioural
 * probes inside a rolled-back transaction (the `20260827120000` precedent) are
 * OWED and recorded as such.
 *
 * ⚠ Deploy state is a MEASUREMENT: `supabase migration list`, joined on the
 * NAME, never on the filename prefix (INVARIANTS §12, F-304).
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const MIGRATIONS = resolve(process.cwd(), "supabase", "migrations");
const NAME = "20260920120000_workspace_kind_personal.sql";

const read = (f: string) => readFileSync(resolve(MIGRATIONS, f), "utf8");
const sql = read(NAME);

describe("the kind set gains exactly one value", () => {
  it("widens the CHECK to the three kinds, drop-then-add so a re-run is a no-op", () => {
    expect(sql).toContain(
      "ALTER TABLE public.workspaces DROP CONSTRAINT IF EXISTS workspaces_kind_check;"
    );
    expect(sql).toMatch(
      /ADD CONSTRAINT workspaces_kind_check CHECK \(kind IN \('standard', 'link', 'personal'\)\)/
    );
  });

  it("is the ONLY migration that widens it, so there is one statement of the set", () => {
    const widening = readdirSync(MIGRATIONS)
      .filter((f) => f.endsWith(".sql"))
      .filter((f) => /workspaces_kind_check CHECK \(kind IN[^)]*personal/.test(read(f)));
    expect(widening).toEqual([NAME]);
  });
});

describe("🔒 exactly one container per user", () => {
  it("is enforced by a PARTIAL UNIQUE INDEX, not only by the function", () => {
    // ⚠ THE INDEX IS THE FENCE AND THE ADVISORY LOCK IS THE ERGONOMICS. A code
    // path that forgets `ensure_personal_container` must be UNABLE to mint a
    // second container, not merely unlikely to.
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS workspaces_personal_owner_uidx\s+ON public\.workspaces \(owner_id\) WHERE kind = 'personal';/
    );
  });

  it("serializes the mint on its OWN advisory-lock namespace", () => {
    expect(sql).toContain(
      "pg_advisory_xact_lock(hashtextextended('ensure_personal_container:' || p_owner_id::text, 0))"
    );
    // ⚠ Sharing `ensure_default_workspace`'s key would make signup and the
    // personal mint block each other for no reason.
    expect(sql).not.toContain("'ensure_default_workspace:'");
  });

  it("mints the owner's MEMBERSHIP row, without which the owner cannot read their own shelf", () => {
    expect(sql).toMatch(
      /INSERT INTO public\.workspace_members[\s\S]{0,160}VALUES \(w\.id, p_owner_id, 'owner', 'active', now\(\)\)/
    );
  });

  it("RETURNS `kind`, or the app labels the container `standard` and rails it", () => {
    // ⚠ `mapWorkspaceRow` reads an ABSENT kind as 'standard' (INVARIANTS §4A) —
    // right for `ensure_default_workspace`, catastrophic here.
    expect(sql).toMatch(/RETURNS TABLE \([\s\S]*?\bkind text,[\s\S]*?created boolean\s*\)/);
    expect(sql).toMatch(/w\.icon_url, w\.kind, w\.created_at/);
  });

  it("is service-role only, restated in the file", () => {
    for (const grantee of ["public", "anon", "authenticated"]) {
      expect(sql).toContain(
        `REVOKE ALL ON FUNCTION public.ensure_personal_container(uuid, text) FROM ${grantee};`
      );
    }
  });
});

describe("🔒 the shelf moves by AUTHOR", () => {
  it("keys both moves on `created_by`, never on the workspace's owner", () => {
    for (const table of ["knowledge_bases k", "agent_templates t"]) {
      const alias = table.split(" ")[1];
      expect(sql, table).toContain(`AND p.owner_id = ${alias}.created_by`);
      expect(sql, table).toContain(`AND ${alias}.home_scoped IS TRUE`);
      // Idempotent: a second run matches nothing.
      expect(sql, table).toContain(`AND ${alias}.workspace_id <> p.id`);
    }
    // A row whose author is gone (`created_by` SET NULL on user delete) has
    // nobody to be given to and is left where it is — the `=` above cannot
    // match NULL, so this is a property of the SQL rather than a promise.
    expect(sql).not.toMatch(/created_by IS NULL[\s\S]{0,80}UPDATE/i);
  });

  it("contains no destructive statement at all", () => {
    // 🔒 `knowledge_bases.workspace_id` is ON DELETE CASCADE, so a `DELETE FROM
    // workspaces` in a personal-container migration destroys personal rows. The
    // revert is prose in the header, in the only safe order, and it is prose
    // precisely so nobody runs it by applying this file.
    expect(sql).not.toMatch(/^\s*(DELETE|DROP TABLE|TRUNCATE|ALTER TABLE .*DROP COLUMN)/im);
  });
});

describe("nothing else has to change for a personal container to work", () => {
  it("`ensure_default_workspace`'s guard already excludes it, POSITIVELY", () => {
    // ⚠ This is why the kind guard is RETIRED in batch 3 rather than repointed
    // now: both of its branches select `kind = 'standard'`, so a third kind is
    // excluded the moment it exists. The negative spelling would have admitted
    // it silently (INVARIANTS §4A, F-295).
    const guard = read("20260823160000_default_workspace_kind_guard.sql");
    const arms = guard.match(/workspaces\.kind = 'standard'/g) ?? [];
    expect(arms.length).toBe(2);
    expect(guard).not.toMatch(/kind\s*(<>|!=)\s*'link'/);
  });

  it("`enforce_resource_grant` lets an ATTRIBUTED grant cross containers", () => {
    // The container is only useful if a personal KB can be lent into a
    // workspace. The trigger fences that on the GRANTOR being a member of both
    // sides — which the owner of a personal container is — and never on the two
    // containers being equal.
    const grants = read("20260914120000_resource_grants.sql");
    expect(grants).toContain(
      "ELSIF NOT is_workspace_member(res_ws, NEW.created_by, 'viewer') THEN"
    );
    expect(grants).toContain(
      "ELSIF NOT is_workspace_member(scope_ws, NEW.created_by, 'viewer') THEN"
    );
    // The only same-container refusal left is the UNATTRIBUTED one.
    const crossRefusals = grants.match(/scope_ws <> res_ws/g) ?? [];
    expect(crossRefusals.length).toBe(1);
    expect(grants).toMatch(/IF NEW\.created_by IS NULL THEN\s*\n\s*IF scope_ws <> res_ws THEN/);
  });
});

describe("ordering", () => {
  it("sorts after every migration this slice was cut from", () => {
    const versions = readdirSync(MIGRATIONS)
      .filter((f) => f.endsWith(".sql"))
      .map((f) => f.slice(0, 14))
      .filter((v) => v < "20260920120000");
    expect(Math.max(...versions.map(Number))).toBeLessThan(20260920120000);
    // ⚠ F-526: the `20260901120000` collision was repaired on 2026-09-03
    // (`credit_usage_events` -> `20260901130000`), so `schema-sql.test.ts` now
    // forbids duplicates outright. A duplicate here would be the first since.
    const mine = readdirSync(MIGRATIONS).filter((f) => f.startsWith("20260920120000"));
    expect(mine).toEqual([NAME]);
  });
});
