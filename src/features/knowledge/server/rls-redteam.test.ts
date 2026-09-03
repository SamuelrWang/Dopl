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
  addMember,
  grantToScope,
  makeWorkspace,
  readableIds,
  revokeFromScope,
} from "@/shared/supabase/rls-redteam-fixture";

const POLICIES = livePolicies();
const SELECT_POLICY = {
  knowledge_bases: "knowledge_bases.knowledge_bases_member_select",
  knowledge_folders: "knowledge_folders.knowledge_folders_member_select",
  knowledge_entries: "knowledge_entries.knowledge_entries_member_select",
} as const;

/**
 * ⚠ **`knowledge_entry_chunks` IS NOT IN THAT MAP, AND ITS ABSENCE IS THE
 * ASSERTION** — F-575, still open (2026-09-02, review of batch 2; Desktop Agent
 * default, Samuel may reverse). RLS has been ENABLED on it with NO policy since
 * `20260612090000`, which fails CLOSED. Phase 2 briefly gave it its parent's
 * policy; that arm was withdrawn, because every other change in that file
 * NARROWS and this one would have widened a table from "nobody" to "every
 * viewer whose base is readable" — **regardless of `RLS_PHASE_2`, because a
 * policy is not behind a flag.**
 */
const DENY_ALL_UNTIL_PHASE_3 = "knowledge_entry_chunks";

/** "May the caller read this base?" — the rule, written once (STEP 4). */
const READABLE = "dopl_knowledge_base_readable";

/**
 * THE GRANT ARM'S WHOLE SHAPE, IN ONE PATTERN: a `)` closing the membership
 * group, then the arm — and the arm is the shared-credential refusal AND the
 * grant, never the grant alone.
 */
const GRANT_ARM =
  /\) OR \( NOT public\.dopl_credential_is_shared\(\) AND public\.dopl_grant_admits\(\s*'knowledge_base', kb\.id\s*\) \)/i;

describe("REDTEAM knowledge — the GRANT arm (F-604)", () => {
  it("🔒 is OR-ed onto a CLOSED membership group, never AND-ed into one", () => {
    // ⚠ THE POSITION IS THE ASSERTION. A grantee is typically NOT a member of
    // the base's container, so an arm conjoined with `is_current_workspace_member`
    // could only ever narrow — the write door B15 shipped would go on writing
    // rows nothing reads.
    const fn = liveFunction(READABLE);
    expect(fn).toMatch(GRANT_ARM);
    expect(fn).not.toMatch(/is_current_workspace_member\([^)]*\)\s*AND\s+public\.dopl_grant_admits/i);
  });

  it("🔒 …and it carries the SHARED-CREDENTIAL refusal with it — `canSeeBase` arm 2 (P25)", () => {
    // 🔒 THIS IS THE ARM THE FIRST DRAFT LOST, and it lost it by being written
    // at the TOP of the predicate: `(membership AND …) OR grant_admits(…)`
    // admitted a credential standing for NOBODY to a row lent to a scope it
    // cannot be a member of, while `canSeeBase` refuses it two arms earlier.
    // A policy that admits what its twin refuses is the whole failure this
    // suite exists to catch, so the conjunct is asserted, not assumed.
    expect(liveFunction(READABLE)).toMatch(
      /NOT public\.dopl_credential_is_shared\(\) AND public\.dopl_grant_admits\(\s*'knowledge_base'/i,
    );
  });

  it("🔒 …and a lent row still answers the TEAMS gate — `assertBaseVisible`'s second question", () => {
    // The TS twin runs `canSeeBase` AND THEN the teams check, and
    // `filterTeamVisibleBases` drops a teams-mode base the caller holds no
    // level on however it became visible. So the gate is AND-ed over the whole
    // readable group; a grant arm OR-ed ABOVE it would route around it.
    const fn = liveFunction(READABLE);
    const teamsAfterGroup =
      /dopl_grant_admits\(\s*'knowledge_base', kb\.id\s*\) \) \) AND \( kb\.access_mode IS DISTINCT FROM 'teams'/i;
    expect(fn).toMatch(teamsAfterGroup);
  });

  it("🔒 the child policies inherit it by asking about the PARENT, not by restating it", () => {
    // The 2026-08-26 incident's shape, kept closed: a child policy that stated
    // its own rule would be a second place the grant arm has to be added.
    for (const table of ["knowledge_folders", "knowledge_entries"]) {
      const policy = POLICIES.get(SELECT_POLICY[table as keyof typeof SELECT_POLICY]) ?? "";
      expect(policy, table).toContain(`${READABLE}(knowledge_base_id)`);
      expect(policy, table).not.toMatch(/dopl_grant_admits/i);
    }
  });
});

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

describe("REDTEAM knowledge_entry_chunks — the table that stays DENY-ALL (F-575)", () => {
  it("🔒 carries NO SELECT policy at all, in either direction", () => {
    // ⚠ THE FENCE IS THE EMPTY SET. A policy here is a WIDENING — this table
    // answers nobody today — and the phase this branch ships promised no net
    // widening while `RLS_PHASE_2` is off. The policy belongs in phase 3, in
    // the same change as the `readClient()` move it unblocks, where a
    // behavioural probe can run against both halves at once.
    const own = [...POLICIES.keys()].filter((k) =>
      k.startsWith(`${DENY_ALL_UNTIL_PHASE_3}.`)
    );
    expect(own).toEqual([]);
  });

  it("and no phase-2 predicate quietly reaches it either", () => {
    // The other way a deny-all table stops being one: a SIBLING policy that
    // joins to it. Nothing in the replayed set may name it in a USING clause.
    const naming = [...POLICIES.entries()].filter(
      ([key, body]) =>
        !key.startsWith(`${DENY_ALL_UNTIL_PHASE_3}.`) &&
        body.includes(DENY_ALL_UNTIL_PHASE_3)
    );
    expect(naming.map(([key]) => key)).toEqual([]);
  });
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
    // ⚠ **THE AXIS MOVED ONE INDIRECTION FURTHER ON 2026-09-02 (F-583) AND THE
    // INVARIANT DID NOT.** `enforce_resource_grant()` needs this rule for a
    // NAMED grantor, and the only statement of it read `auth.uid()`. So the
    // rule is `dopl_teams_visible_for_user` and `dopl_teams_mode_visible` is one
    // line over it — asserting on the CALLER would read a de-duplication as a
    // lost fence, which is the mistake B12's own note warns about.
    const teams = liveFunction("dopl_teams_visible_for_user");
    expect(teams).toMatch(/is_workspace_member\(p_workspace_id, p_user_id, 'admin'\)/i);
    expect(teams).toMatch(/p_created_by\s*=\s*p_user_id/i);
    // …and the caller-scoped case supplies `auth.uid()` and nothing else, so a
    // policy still cannot be handed a user id it chose.
    expect(liveFunction("dopl_teams_mode_visible")).toMatch(
      /dopl_teams_visible_for_user\(\s*\(\s*SELECT auth\.uid\(\)\s*\)/i
    );
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
    expect(teams).toMatch(/tm\.user_id\s*=\s*p_user_id/i);
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
    let outsiderContainerId = "";
    let privateBaseId = "";
    let publicBaseId = "";

    beforeAll(async () => {
      ownerId = await makeUser("owner");
      outsiderId = await makeUser("outsider");
      workspaceId = await makeWorkspace(ownerId);
      // The BORROWING container: the outsider owns it, and the grantor is a
      // member so `enforce_resource_grant` will accept a grant into it.
      outsiderContainerId = await makeWorkspace(outsiderId);
      await addMember(outsiderContainerId, ownerId, "member");

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
      await deleteWorkspace(outsiderContainerId);
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

    it("🔒 GRANTED INTO A CONTAINER → visible to that container's members; REVOKED → invisible (F-604)", async () => {
      // Ruling B11 end to end: a `private` base lent to a container the
      // OUTSIDER belongs to. The "%s: a NON-MEMBER sees zero rows" case above
      // is the same reader with no grant, so this pair is the arm's whole
      // evidence — and the REVOKE half is where a `true` predicate would show.
      const ref = {
        workspaceId,
        scopeType: "container" as const,
        scopeId: outsiderContainerId,
        resourceType: "knowledge_base" as const,
        resourceId: privateBaseId,
      };
      await grantToScope({ ...ref, createdBy: ownerId });
      expect(await rows(outsiderId, "knowledge_bases")).toEqual([privateBaseId]);
      // 🔒 AND THE CHILDREN FOLLOW THE PARENT, which is the property both child
      // policies are built on — they ask `dopl_knowledge_base_readable` about
      // the base, so a grant reaches the folder and the entry without either
      // policy learning what a grant is.
      expect(await rows(outsiderId, "knowledge_entries")).toHaveLength(1);

      await revokeFromScope(ref);
      expect(await rows(outsiderId, "knowledge_bases")).toHaveLength(0);
      expect(await rows(outsiderId, "knowledge_entries")).toHaveLength(0);
    });

    it("🔒 P25 — a SHARED CREDENTIAL is not widened by that grant, live", async () => {
      // The same row, the same reader, the same grant — and the ONE axis that
      // changes is whether the credential stands for a person. `canSeeBase`
      // refuses at arm 2 and the policy must refuse with it.
      const ref = {
        workspaceId,
        scopeType: "container" as const,
        scopeId: outsiderContainerId,
        resourceType: "knowledge_base" as const,
        resourceId: privateBaseId,
      };
      await grantToScope({ ...ref, createdBy: ownerId });
      try {
        expect(await rows(outsiderId, "knowledge_bases")).toEqual([privateBaseId]);
        expect(await rows(outsiderId, "knowledge_bases", true)).toHaveLength(0);
        expect(await rows(outsiderId, "knowledge_entries", true)).toHaveLength(0);
      } finally {
        await revokeFromScope(ref);
      }
    });
  }
);
