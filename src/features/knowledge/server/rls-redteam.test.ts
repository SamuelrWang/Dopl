/**
 * REDTEAM — the POLICY, alone, refuses what the TS predicate refuses, for each
 * of the first three knowledge tables (Wave B B7; Samuel's ruling B5, "RLS is
 * the fence"; RLS plan phase 1's *"a redteam case per table proving a non-member
 * gets zero rows"*).
 *
 * 🔒 WHY A REDTEAM SUITE IS THE DELIVERABLE AND NOT A NICETY. Until this slice,
 * every visibility rule on these tables was written TWICE — a TS predicate that
 * is the real fence and a policy that never runs, because every repository read
 * went through the service role. Two statements of one rule drift, and this pair
 * had: the live policy admitted a SHARED CREDENTIAL to a private row
 * (`canSeeBase`'s middle arm, M-10/F-336) and said nothing at all about
 * `access_mode = 'teams'`. A policy is allowed to be the fence only once
 * something proves it refuses the same things.
 *
 * ⚠ TWO HALVES, AND THE SECOND ONE DOES NOT RUN HERE. The SQL half replays
 * every migration and asserts on the FINAL policy and function bodies; the live
 * half is skipped unless `RLS_REDTEAM_LIVE=1` against a local stack. ⚠ IT HAS
 * NEVER RUN — Docker was down on the authoring machine, so `supabase start`
 * could not run and `20260919120000` has never been applied to any database.
 * ⚠ A STRUCTURAL ASSERTION IS NOT A BEHAVIOURAL ONE (F-523): the SQL half
 * proves the rule is WRITTEN once and names every arm; only the live half proves
 * Postgres AGREES.
 *
 * ⚠ BOTH HALVES ARE SHARED WITH B12's THREE SUITES — `shared/supabase/
 * rls-policy-scan.ts` (the replay, and why comments are stripped) and
 * `shared/supabase/rls-redteam-fixture.ts` (the tenants, and the command that
 * runs the live half). This file was the first of the four and held both inline
 * until phase 2 needed them a second time.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { livePolicies, liveFunction } from "@/shared/supabase/rls-policy-scan";
import {
  deleteUsers,
  deleteWorkspace,
  liveRedteamEnabled,
  makeUser,
  makeWorkspace,
  readableIds,
} from "@/shared/supabase/rls-redteam-fixture";

const POLICIES = livePolicies();
const SELECT_POLICY = {
  knowledge_bases: "knowledge_bases.knowledge_bases_member_select",
  knowledge_folders: "knowledge_folders.knowledge_folders_member_select",
  knowledge_entries: "knowledge_entries.knowledge_entries_member_select",
} as const;

/** "May the caller read this base?" — the rule, written once (STEP 4). */
const READABLE = "dopl_knowledge_base_readable";

describe("the read rule is stated ONCE", () => {
  it("every table's SELECT policy defers to the same function", () => {
    for (const key of Object.values(SELECT_POLICY)) {
      expect(POLICIES.get(key)).toContain(`${READABLE}(`);
    }
  });

  // ⚠ THE CLAIM-NAME CONTRACT MOVED, it was not dropped: it is not a knowledge
  // fact, and it is now asserted once — beside the second half of the same
  // question ("`shared` is the ONLY thing a policy reads out of the claim") — in
  // `shared/supabase/rls-redteam-resource-grants.test.ts`.
});

describe("REDTEAM knowledge_bases — the policy alone", () => {
  const policy = () => POLICIES.get(SELECT_POLICY.knowledge_bases) ?? "";

  it("refuses a NON-MEMBER: membership is the outermost arm, and it is the caller-pinned form", () => {
    // ⚠ `is_current_workspace_member` (2-arg), never `is_workspace_member`
    // (3-arg): the 3-arg form lets the CALLER supply the user id and was the
    // membership oracle M-9 closed.
    expect(liveFunction(READABLE)).toMatch(
      /is_current_workspace_member\(\s*kb\.workspace_id,\s*'viewer'\s*\)/i
    );
    expect(liveFunction(READABLE)).not.toMatch(/[^_]is_workspace_member\(/i);
  });

  it("refuses a SHARED CREDENTIAL a private row — canSeeBase's middle arm (M-10 / F-336)", () => {
    const visibility = liveFunction("dopl_can_see_visibility");
    expect(visibility).toMatch(/p_visibility\s*=\s*'public'/i);
    expect(visibility).toMatch(/NOT\s+public\.dopl_credential_is_shared\(\)/i);
    expect(visibility).toMatch(/p_created_by\s*=\s*\(\s*SELECT auth\.uid\(\)\s*\)/i);
    expect(liveFunction(READABLE)).toContain("dopl_can_see_visibility(kb.visibility, kb.created_by)");
  });

  it("refuses a TEAMS-MODE row with no grant — the arm the old policy did not have at all", () => {
    expect(liveFunction(READABLE)).toMatch(/access_mode IS DISTINCT FROM 'teams'/i);
    const teams = liveFunction("dopl_teams_mode_visible");
    expect(teams).toMatch(/is_current_workspace_member\(p_workspace_id, 'admin'\)/i);
    expect(teams).toMatch(/p_created_by\s*=\s*\(\s*SELECT auth\.uid\(\)\s*\)/i);
    // ⚠ THE GRANT TABLE IS `resource_grants` SINCE B1 FOLDED THE TEAM AXIS INTO
    // IT, and the `scope_type` term is asserted with it rather than beside it:
    // this helper reading the table WITHOUT that term would answer "is this
    // teams-mode resource visible to me" with a CHANNEL grant on the same
    // resource — a room's audience silently becoming a workspace-wide read
    // (F-468). The two belong in one assertion because either alone passes on
    // the leak.
    expect(teams).toMatch(
      /FROM\s+public\.resource_grants\s+g\b[\s\S]*?g\.scope_type\s*=\s*'team'/i
    );
    expect(teams).not.toMatch(/team_resource_access/i);
    expect(teams).toMatch(/tm\.user_id\s*=\s*\(\s*SELECT auth\.uid\(\)\s*\)/i);
  });

  it("does NOT hide soft-deleted rows — trash is a repository filter, not a fence", () => {
    expect(policy()).not.toMatch(/deleted_at/i);
  });
});

describe.each([
  ["knowledge_folders", SELECT_POLICY.knowledge_folders],
  ["knowledge_entries", SELECT_POLICY.knowledge_entries],
] as const)("REDTEAM %s — the policy alone", (table, key) => {
  const policy = () => POLICIES.get(key) ?? "";

  it("refuses a NON-MEMBER: the workspace arm is on the row itself", () => {
    expect(policy()).toMatch(
      /is_current_workspace_member\(workspace_id, 'viewer'::text\)/i
    );
  });

  it(`refuses a row whose BASE the caller cannot read — the 2026-08-26 entry-body leak, in the database`, () => {
    // `GET /api/knowledge/entries/[entryId]` checked the workspace and nothing
    // else, so a viewer read the body of an entry inside a private base. A
    // child policy that asked only for membership would reintroduce it.
    expect(policy()).toContain(`${READABLE}(knowledge_base_id)`);
  });

  it("inherits BOTH narrowing arms through that one call, rather than restating them", () => {
    expect(policy()).not.toMatch(/visibility\s*=/i);
    expect(policy()).not.toMatch(/access_mode/i);
    expect(`${table}`).toBe(table);
  });
});

/* ────────────────────────── the live half ────────────────────────── */

/** ⚠ SKIPPED-WITH-REASON — see `shared/supabase/rls-redteam-fixture.ts` for the
 *  measurement (Docker is down here) and the command that runs it. */
describe.skipIf(!liveRedteamEnabled)(
  "REDTEAM (live) — a non-member gets ZERO rows through the caller client",
  () => {
    let ownerId = "";
    let outsiderId = "";
    let workspaceId = "";
    let privateBaseId = "";
    let publicBaseId = "";

    beforeAll(async () => {
      ownerId = await makeUser("owner");
      outsiderId = await makeUser("outsider");
      workspaceId = await makeWorkspace(ownerId);

      // Seeded through the repository's own inserts — writes stay service-role,
      // so the fixture cannot be shaped by the fence it is testing.
      const repo = await import("./repository");
      const priv = await repo.insertBase({
        workspaceId,
        name: "Private",
        slug: "private",
        visibility: "private",
        createdBy: ownerId,
      });
      const pub = await repo.insertBase({
        workspaceId,
        name: "Public",
        slug: "public",
        visibility: "public",
        createdBy: ownerId,
      });
      privateBaseId = priv.id;
      publicBaseId = pub.id;
      const folder = await repo.insertFolder({
        workspaceId,
        knowledgeBaseId: privateBaseId,
        name: "Folder",
        createdBy: ownerId,
      });
      await repo.insertEntry({
        workspaceId,
        knowledgeBaseId: privateBaseId,
        folderId: folder.id,
        title: "Entry",
        body: "secret",
        createdBy: ownerId,
        source: "user",
      });
    }, 60_000);

    afterAll(async () => {
      await deleteWorkspace(workspaceId);
      await deleteUsers([ownerId, outsiderId]);
    }, 60_000);

    const rows = (userId: string, table: string, shared = false) =>
      readableIds(userId, table, workspaceId, { shared });

    it.each(["knowledge_bases", "knowledge_folders", "knowledge_entries"])(
      "%s: a NON-MEMBER sees zero rows",
      async (table) => {
        expect(await rows(outsiderId, table)).toHaveLength(0);
      }
    );

    it("knowledge_bases: the owner sees both of their own bases", async () => {
      const ids = await rows(ownerId, "knowledge_bases");
      expect(ids).toEqual(expect.arrayContaining([privateBaseId, publicBaseId]));
    });

    it("🔒 a SHARED CREDENTIAL on the owner's id sees the public base and NOT the private one", async () => {
      const ids = await rows(ownerId, "knowledge_bases", true);
      expect(ids).toContain(publicBaseId);
      expect(ids).not.toContain(privateBaseId);
    });

    it.each(["knowledge_folders", "knowledge_entries"])(
      "%s: a shared credential cannot reach a child of a private base",
      async (table) => {
        expect(await rows(ownerId, table, true)).toHaveLength(0);
      }
    );
  }
);
