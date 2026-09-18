/**
 * `enforce_resource_grant` — "the grantor may share this" — read out of the
 * replayed migration set. `schema-sql.test.ts` pins who may READ a grant row;
 * this file pins the validity trigger, which decides whether the row may EXIST.
 *
 * A structural assertion is not a behavioural one (F-523): these prove the rule
 * is written once and names every arm, but only a database says what the trigger
 * does. `20260921140000`'s header carries the six owed probes (P15–P20), which
 * CI's `rls-redteam` job is the first thing that can pay.
 */

import { describe, it, expect } from "vitest";
import { FILES, liveFunctionBody } from "./migration-replay";

describe("🔒 enforce_resource_grant — 'the grantor may share this'", () => {
  const BODY = liveFunctionBody("enforce_resource_grant");

  it("is the live validity trigger, and its predecessors are gone", () => {
    expect(BODY).not.toBeNull();
    // The predecessors it replaces.
    expect(liveFunctionBody("assert_team_grant_workspace")).toBeNull();
    expect(liveFunctionBody("assert_agent_template_team_workspace")).toBeNull();
  });

  it("files the row under the RESOURCE's container, and refuses any other", () => {
    // One canonical tenancy per row: every `workspace_id`-filtered read in the
    // app depends on it.
    expect(BODY).toMatch(/res_ws\s*<>\s*NEW\.workspace_id/i);
    expect(BODY).toMatch(/resource workspace mismatch/i);
  });

  it("🔒 asserts the grantor reaches BOTH containers — the whole of ruling B4", () => {
    // Deleting either branch turns the trigger back into a workspace-equality
    // check and fails no application test: the service gate still refuses what
    // it knows about, PostgREST does not.
    expect(BODY).toMatch(
      /NOT\s+is_workspace_member\(\s*res_ws\s*,\s*NEW\.created_by/i
    );
    expect(BODY).toMatch(
      /NOT\s+is_workspace_member\(\s*scope_ws\s*,\s*NEW\.created_by/i
    );
    expect(BODY).toMatch(/may not share into container/i);
  });

  it("🔒 the RESOURCE side is a RANK and the resource's own test, not membership (F-583)", () => {
    // `'viewer'` here was the defect: it asked only whether the grantor is in
    // the container, so a read-only member could lend out a `private` base they
    // cannot read.
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
    // The five `canSee*` matrices, asked about a named user — including the two
    // owner columns that are not `created_by`.
    for (const table of ["knowledge_bases", "skills", "chats", "chat_folders", "agent_templates"]) {
      expect(SHARE, table).toMatch(new RegExp(String.raw`FROM\s+public\.${table}\b`, "i"));
    }
    expect(SHARE).toMatch(/r\.owner_id\s*=\s*p_user_id/i);
    expect(SHARE).toMatch(/r\.user_id\s*=\s*p_user_id/i);
    // An unknown type must refuse, not skip: a NULL makes the trigger's `NOT …`
    // term unknown and lets the arm fall through.
    expect(SHARE).toMatch(/ELSE\s+false/i);
    // The rank is inside the test too, so no branch can answer `true` for a
    // grantor who is only a viewer.
    expect(SHARE?.match(/is_workspace_member\([^)]*'member'\)/gi)?.length).toBe(5);
  });

  it("🔒 de-attribution by ON DELETE SET NULL is not re-validated (F-584)", () => {
    // Without this the trigger RAISEs on a legal cross-container grant when the
    // grantor's account is deleted, making the account undeletable. The skip is
    // narrow — UPDATE, NOT NULL → NULL, every other column identical — so a
    // de-attribute-and-move is still a re-grant.
    expect(BODY).toMatch(/TG_OP\s*=\s*'UPDATE'/i);
    expect(BODY).toMatch(/OLD\.created_by\s+IS\s+NOT\s+NULL/i);
    expect(BODY).toMatch(/IS\s+NOT\s+DISTINCT\s+FROM/i);
    expect(BODY).toMatch(/OLD\.guest_write/i);
  });

  it("🔒 keeps the OLD same-container rule for an unattributed row", () => {
    // `created_by` is ON DELETE SET NULL and backfilled team rows never had one,
    // so without this branch a NULL grantor passes both checks above.
    expect(BODY).toMatch(/NEW\.created_by\s+IS\s+NULL/i);
    expect(BODY).toMatch(/scope_ws\s*<>\s*res_ws/i);
    expect(BODY).toMatch(/unattributed grant may not cross containers/i);
  });

  it("🔒 the backfill carries a DEPARTED grantor as unattributed, not verbatim (F-582)", () => {
    // A backfill RAISE aborts the migration. `created_by` outlives a membership
    // (`ON DELETE SET NULL` clears it only when the auth user is deleted), so a
    // historical row whose grantor merely left would meet the arm above and take
    // the apply down. Nulling loses nothing: every row reaching those statements
    // is same-container by construction.
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
