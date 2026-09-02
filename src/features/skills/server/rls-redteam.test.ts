/**
 * REDTEAM — the POLICY, alone, refuses what `service-shared.ts › canSeeSkill`
 * refuses (Wave B B12; Samuel's ruling B5, "RLS is the fence").
 *
 * 🔒 THE TWO GAPS THIS SUITE EXISTS TO KEEP CLOSED. Until `20260921120000` the
 * live `skills_member_select` was
 *
 *     is_current_workspace_member(workspace_id,'viewer')
 *     AND (visibility = 'public' OR created_by = auth.uid())
 *
 * which (1) handed a SHARED CREDENTIAL a private row — `canSeeSkill` arm 2
 * refuses one before it ever reaches the creator arm (M-10/F-336) — and (2) said
 * nothing at all about `access_mode='teams'`, so every viewer read a skill
 * narrowed to one team. `20260708150001` recorded the second one in a comment
 * — *"team scoping [is] enforced in the service"* — which was true while the
 * service was the only reader and is a leak the moment a read moves off the
 * service role.
 *
 * ⚠ TWO HALVES, and the SQL half is the one that runs. See
 * `shared/supabase/rls-policy-scan.ts` for what a structural assertion does and
 * does not prove (F-523), and `shared/supabase/rls-redteam-fixture.ts` for why
 * the live half is skipped and the command that runs it.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { livePolicies, liveFunction } from "@/shared/supabase/rls-policy-scan";
import {
  addMember,
  deleteUsers,
  deleteWorkspace,
  grantToScope,
  liveRedteamEnabled,
  makeTeam,
  makeUser,
  makeWorkspace,
  readableIds,
} from "@/shared/supabase/rls-redteam-fixture";

const POLICIES = livePolicies();

/** "May the caller read this skill?" — the rule, written once. */
const READABLE = "dopl_skill_readable";
/** The `public`/`teams` matrix `canSeeSkill` and `canSeeChat` share. */
const MATRIX = "dopl_public_teams_admits";

describe("REDTEAM skills — the policy alone", () => {
  const policy = () => POLICIES.get("skills.skills_member_select") ?? "";

  it("states the rule ONCE — the policy is the predicate applied to the row", () => {
    expect(policy()).toContain(`${READABLE}(id)`);
    expect(policy()).not.toMatch(/visibility\s*=/i);
    expect(policy()).not.toMatch(/access_mode/i);
  });

  it("refuses a NON-MEMBER, in the caller-pinned form", () => {
    // ⚠ `is_current_workspace_member` (2-arg), never `is_workspace_member`
    // (3-arg): the 3-arg form lets the CALLER supply the user id and was the
    // membership oracle M-9 closed.
    expect(liveFunction(READABLE)).toMatch(
      /is_current_workspace_member\(\s*s\.workspace_id,\s*'viewer'\s*\)/i
    );
    expect(liveFunction(READABLE)).not.toMatch(/[^_]is_workspace_member\(/i);
  });

  it("refuses a SHARED CREDENTIAL a private row — canSeeSkill arm 2 (M-10/F-336)", () => {
    const matrix = liveFunction(MATRIX);
    expect(matrix).toMatch(/NOT\s+public\.dopl_credential_is_shared\(\)/i);
    // Arm 1 sits OUTSIDE that guard on purpose: a `public`/`workspace` row holds
    // nothing personal, and `canSeeSkill` returns true for it before asking.
    expect(matrix).toMatch(
      /p_visibility\s*=\s*'public'\s+AND\s+p_access_mode\s+IS\s+DISTINCT\s+FROM\s+'teams'/i
    );
  });

  it("refuses a TEAMS-MODE skill with no grant — the arm the old policy did not have", () => {
    expect(liveFunction(READABLE)).toContain(`${MATRIX}(`);
    expect(liveFunction(READABLE)).toContain("'skill', s.id");
    const matrix = liveFunction(MATRIX);
    expect(matrix).toMatch(/dopl_teams_mode_visible\(\s*p_workspace_id, p_resource_type/i);
    // ⚠ AND THE ADMIN ARM IS INSIDE THAT CALL, not above it: `dopl_teams_mode_visible`
    // admits an admin, and it is only reached once `p_visibility = 'public'` has
    // held — so `private` still means private, admins included, exactly as
    // `canSeeSkill` returns false for `visibility !== "public"` before its own
    // admin check.
    expect(matrix).toMatch(/p_visibility\s*=\s*'public'\s*AND\s*public\.dopl_teams_mode_visible/i);
  });

  it("fences the CHILD table on the parent, and retires a caller-supplied uid", () => {
    const files = POLICIES.get("skill_files.skill_files_member_select") ?? "";
    expect(files).toContain(`${READABLE}(skill_id)`);
    expect(files).toMatch(/is_current_workspace_member\(workspace_id, 'viewer'::text\)/i);
    // The body replaced asked `is_workspace_member(workspace_id, auth.uid(), …)`.
    expect(files).not.toMatch(/[^_]is_workspace_member\(/i);
    // …and it inherits the narrowing arms rather than restating them.
    expect(files).not.toMatch(/visibility\s*=/i);
  });

  it("does NOT hide soft-deleted rows — trash is a repository filter, not a fence", () => {
    expect(policy()).not.toMatch(/deleted_at/i);
    expect(liveFunction(READABLE)).not.toMatch(/deleted_at/i);
  });
});

/* ────────────────────────── the live half ────────────────────────── */

describe.skipIf(!liveRedteamEnabled)(
  "REDTEAM skills (live) — the caller client, against a real policy",
  () => {
    let ownerId = "";
    let outsiderId = "";
    let guestId = "";
    let teammateId = "";
    let workspaceId = "";
    let teamId = "";
    let publicSkillId = "";
    let privateSkillId = "";
    let teamSkillId = "";

    beforeAll(async () => {
      ownerId = await makeUser("owner");
      outsiderId = await makeUser("outsider");
      guestId = await makeUser("guest");
      teammateId = await makeUser("teammate");
      workspaceId = await makeWorkspace(ownerId);
      await addMember(workspaceId, guestId, "guest");
      await addMember(workspaceId, teammateId, "member");
      teamId = await makeTeam(workspaceId, teammateId);

      // Seeded through the repository's own inserts — writes stay service-role,
      // so the fixture cannot be shaped by the fence it is testing.
      const repo = await import("./repository");
      const base = {
        workspaceId,
        description: "",
        whenToUse: "",
        createdBy: ownerId,
        source: "user" as const,
      };
      publicSkillId = (
        await repo.insertSkill({ ...base, slug: "pub", name: "Public", visibility: "public" })
      ).id;
      privateSkillId = (
        await repo.insertSkill({ ...base, slug: "priv", name: "Private", visibility: "private" })
      ).id;
      const team = await repo.insertSkill({
        ...base,
        slug: "team",
        name: "Team",
        visibility: "public",
      });
      teamSkillId = team.id;
      await repo.updateSkillRow(teamSkillId, { accessMode: "teams" });
      await grantToScope({
        workspaceId,
        scopeType: "team",
        scopeId: teamId,
        resourceType: "skill",
        resourceId: teamSkillId,
        createdBy: ownerId,
      });
    }, 60_000);

    afterAll(async () => {
      await deleteWorkspace(workspaceId);
      await deleteUsers([ownerId, outsiderId, guestId, teammateId]);
    }, 60_000);

    it.each(["skills", "skill_files"])("%s: a NON-MEMBER sees zero rows", async (table) => {
      expect(await readableIds(outsiderId, table, workspaceId)).toHaveLength(0);
    });

    it("a GUEST sees zero rows — the floor is rank, not a separate arm", async () => {
      expect(await readableIds(guestId, "skills", workspaceId)).toHaveLength(0);
    });

    it("🔒 a SHARED CREDENTIAL on the owner's id sees the public skill and NOT the private one", async () => {
      const ids = await readableIds(ownerId, "skills", workspaceId, { shared: true });
      expect(ids).toContain(publicSkillId);
      expect(ids).not.toContain(privateSkillId);
    });

    it("a TEAMMATE with a grant sees the teams-mode skill; a member without one does not", async () => {
      expect(await readableIds(teammateId, "skills", workspaceId)).toContain(teamSkillId);
      expect(await readableIds(guestId, "skills", workspaceId)).not.toContain(teamSkillId);
    });

    it("🔒 the CONTAINER LOCK widens nothing — the same caller, locked to a foreign container", async () => {
      // `scopeFor` always sets `credentialWorkspaceId` to a container that is not
      // this workspace. Membership is re-derived from the database by
      // `is_current_workspace_member`, which no claim can widen or narrow.
      expect(await readableIds(ownerId, "skills", workspaceId)).toContain(privateSkillId);
    });
  }
);
