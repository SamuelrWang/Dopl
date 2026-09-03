/**
 * 🔒 **`enforce_resource_grant` — "THE GRANTOR MAY SHARE THIS"**, read out of
 * the replayed migration set.
 *
 * ⚠ **SPLIT OUT OF `schema-sql.test.ts` ON 2026-09-02** (§1's 500-line cap),
 * when the batch-2 review repaired two of the trigger's arms and the backfill
 * beside it. The seam is the one the code already has: that file pins the RLS
 * POLICIES — who may READ a grant row — and this one pins the VALIDITY TRIGGER,
 * which decides whether the row may EXIST. Different statement, different
 * failure mode, different thing to read when it goes red.
 *
 * ⚠ MUTATION-VERIFIED. Each of these turns an assertion below red: deleting the
 * `may not share into container` branch, the unattributed-cross-container
 * branch, the `dopl_user_may_share_resource` call, the `'member'` rank or the
 * de-attribution skip; restating the teams axis inside `dopl_teams_mode_visible`
 * instead of delegating; and dropping either backfill's departed-grantor CASE.
 *
 * ⚠ **A STRUCTURAL ASSERTION IS NOT A BEHAVIOURAL ONE (F-523).** These prove the
 * rule is WRITTEN once and names every arm; only a database says what the
 * trigger DOES. `20260921140000`'s header carries the six probes (P15–P20) that
 * are owed, and CI's `rls-redteam` job is the first thing that can pay them.
 */

import { describe, it, expect } from "vitest";
import { FILES, liveFunctionBody } from "./migration-replay";

describe("🔒 enforce_resource_grant — 'the grantor may share this'", () => {
  const BODY = liveFunctionBody("enforce_resource_grant");

  it("is the live validity trigger, and its predecessors are gone", () => {
    expect(BODY).not.toBeNull();
    // The five-migration `CREATE OR REPLACE` chain and the channel trigger it
    // replaces: one is dropped, the other is left standing only for the
    // compatibility mirror on the old table.
    expect(liveFunctionBody("assert_team_grant_workspace")).toBeNull();
    expect(liveFunctionBody("assert_agent_template_team_workspace")).toBeNull();
  });

  it("files the row under the RESOURCE's container, and refuses any other", () => {
    // ⚠ One canonical tenancy per row: every `workspace_id`-filtered read in the
    // app depends on this, and it is the ONE equality the fold kept.
    expect(BODY).toMatch(/res_ws\s*<>\s*NEW\.workspace_id/i);
    expect(BODY).toMatch(/resource workspace mismatch/i);
  });

  it("🔒 asserts the grantor reaches BOTH containers — the whole of ruling B4", () => {
    // Deleting either branch is the mutation that turns the trigger back into a
    // workspace-equality check with extra steps, and it would not fail any
    // application test: the service gate would still refuse the cases it knows
    // about, and PostgREST would not.
    expect(BODY).toMatch(
      /NOT\s+is_workspace_member\(\s*res_ws\s*,\s*NEW\.created_by/i
    );
    expect(BODY).toMatch(
      /NOT\s+is_workspace_member\(\s*scope_ws\s*,\s*NEW\.created_by/i
    );
    expect(BODY).toMatch(/may not share into container/i);
  });

  it("🔒 the RESOURCE side is a RANK and the resource's own test, not membership (F-583)", () => {
    // ⚠ `'viewer'` here was the defect: it asked "is the grantor in this
    // container at all", so a read-only member could lend out a `private` base
    // they cannot read, or a `teams`-mode skill no team of theirs holds — and
    // `resource_grants` IS the fence the readers of those consult.
    expect(BODY).toMatch(
      /is_workspace_member\(\s*res_ws\s*,\s*NEW\.created_by\s*,\s*'member'\s*\)/i
    );
    expect(BODY).toMatch(/is not edit-capable/i);
    expect(BODY).toMatch(
      /dopl_user_may_share_resource\(\s*NEW\.created_by\s*,\s*NEW\.resource_type\s*,\s*NEW\.resource_id\s*\)/i
    );
    // The scope side is deliberately NOT raised: lending INTO a room you can
    // see is not an edit to that room.
    expect(BODY).toMatch(
      /is_workspace_member\(\s*scope_ws\s*,\s*NEW\.created_by\s*,\s*'viewer'\s*\)/i
    );
  });

  it("🔒 the share test answers per resource type, and `false` for an unknown one (F-583)", () => {
    const SHARE = liveFunctionBody("dopl_user_may_share_resource");
    expect(SHARE).not.toBeNull();
    // The five `canSee*` matrices, asked about a NAMED user — including the two
    // owner columns that are not `created_by`.
    for (const table of ["knowledge_bases", "skills", "chats", "chat_folders", "agent_templates"]) {
      expect(SHARE, table).toMatch(new RegExp(String.raw`FROM\s+public\.${table}\b`, "i"));
    }
    expect(SHARE).toMatch(/r\.owner_id\s*=\s*p_user_id/i);
    expect(SHARE).toMatch(/r\.user_id\s*=\s*p_user_id/i);
    // An unknown type must REFUSE, not skip: a NULL would make the trigger's
    // `NOT …` term unknown and let the arm fall through.
    expect(SHARE).toMatch(/ELSE\s+false/i);
    // The rank is inside the test too, so no branch can answer `true` for a
    // grantor who is only a viewer.
    expect(SHARE?.match(/is_workspace_member\([^)]*'member'\)/gi)?.length).toBe(5);
  });

  it("🔒 de-attribution by ON DELETE SET NULL is not re-validated (F-584)", () => {
    // Without this the trigger RAISEs on a legal cross-container grant when its
    // grantor's account is deleted, and the DELETE fails — the account becomes
    // undeletable. The skip is narrow: UPDATE, NOT NULL → NULL, every other
    // column identical, so a de-attribute-and-move is still a re-grant.
    expect(BODY).toMatch(/TG_OP\s*=\s*'UPDATE'/i);
    expect(BODY).toMatch(/OLD\.created_by\s+IS\s+NOT\s+NULL/i);
    expect(BODY).toMatch(/IS\s+NOT\s+DISTINCT\s+FROM/i);
    expect(BODY).toMatch(/OLD\.guest_write/i);
  });

  it("🔒 keeps the OLD same-container rule for an unattributed row", () => {
    // `created_by` is ON DELETE SET NULL and the backfilled team rows never had
    // one, so reach across containers has to be bought with an audit trail.
    // Without this branch a NULL grantor would silently pass both checks above.
    expect(BODY).toMatch(/NEW\.created_by\s+IS\s+NULL/i);
    expect(BODY).toMatch(/scope_ws\s*<>\s*res_ws/i);
    expect(BODY).toMatch(/unattributed grant may not cross containers/i);
  });

  it("🔒 the backfill carries a DEPARTED grantor as unattributed, not verbatim (F-582)", () => {
    // ⚠ A BACKFILL RAISE ABORTS THE MIGRATION. `created_by` outlives a
    // MEMBERSHIP — `ON DELETE SET NULL` clears it only when the auth user is
    // deleted — so a historical row whose grantor merely LEFT would have met
    // the arm above and taken the whole apply down on the first such row.
    // Nulling loses nothing the table enforces: every row reaching those
    // statements is same-container by construction.
    const file = FILES.find((f) => f.name.startsWith("20260914120000"))!;
    const backfills = file.sql.match(
      /CASE WHEN is_workspace_member\(\s*\w+\.workspace_id,\s*\w+\.(?:created_by|granted_by),\s*'viewer'\)\s*\n?\s*THEN \w+\.(?:created_by|granted_by) END/g
    );
    // Both attributed backfills: the channel grants and the template teams.
    expect(backfills?.length).toBe(2);
  });

  it("resolves all three scopes and all five resource types, or RAISEs", () => {
    for (const scope of ["channels", "workspaces", "teams"]) {
      expect(BODY).toMatch(new RegExp(String.raw`FROM\s+${scope}\b`, "i"));
    }
    for (const table of [
      "knowledge_bases",
      "agent_templates",
      "skills",
      "chats",
      "chat_folders",
    ]) {
      expect(BODY).toMatch(new RegExp(String.raw`FROM\s+${table}\b`, "i"));
    }
    expect(BODY).toMatch(/unsupported scope_type/i);
    expect(BODY).toMatch(/unsupported resource_type/i);
  });
});
