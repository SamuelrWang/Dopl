/**
 * REDTEAM — the POLICY, alone, refuses what `service-shared.ts › canSeeTemplate`
 * refuses (Wave B B12; Samuel's ruling B5, "RLS is the fence").
 *
 * 🔒 THE GAP THIS SUITE EXISTS TO KEEP CLOSED, and it was an OMISSION rather
 * than a divergence. `can_current_user_read_agent_template()` (`20260915120000`)
 * collapsed three inline copies of the matrix into one predicate and carried
 * FIVE of `canSeeTemplate`'s six arms across — every one except **arm 2, the
 * SHARED CREDENTIAL**. So a credential that may be passed between humans read
 * the rows its minter created, by name, through PostgREST. `20260921120000`
 * replaces the function in place; no policy moves, which is the payoff of
 * having made the matrix a function in the first place.
 *
 * ⚠ ARM 1 IS OUTSIDE THAT GUARD, DELIBERATELY. `canSeeTemplate` answers `true`
 * for `visibility = 'workspace'` BEFORE asking about the credential — a
 * workspace template holds nothing personal — and the SQL keeps that order.
 * ⚠ ARM 4 BEFORE ARM 5 IS "PRIVATE MEANS PRIVATE": the admin arm stays INSIDE
 * the `team` branch. `20260915120000` says moving it out is a widening, and this
 * suite is what would notice.
 *
 * ⚠ TWO HALVES; see `shared/supabase/rls-policy-scan.ts` (what a structural
 * assertion proves, F-523) and `shared/supabase/rls-redteam-fixture.ts` (why the
 * live half is skipped, and the command that runs it).
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
  revokeFromScope,
} from "@/shared/supabase/rls-redteam-fixture";

const POLICIES = livePolicies();

/** The matrix, stated once — `20260915120000` collapsed three copies onto it. */
const READABLE = "can_current_user_read_agent_template";

describe("REDTEAM agent_templates — the policy alone", () => {
  const policy = () => POLICIES.get("agent_templates.agent_templates_member_select") ?? "";

  it("states the matrix ONCE — the policy is the predicate applied to the row", () => {
    expect(policy()).toContain(`${READABLE}(id)`);
    expect(policy()).not.toMatch(/visibility\s*=/i);
  });

  it("refuses a NON-MEMBER, in the caller-pinned form", () => {
    expect(liveFunction(READABLE)).toMatch(
      /is_current_workspace_member\(t\.workspace_id, 'viewer'::text\)/i
    );
    expect(liveFunction(READABLE)).not.toMatch(/[^_]is_workspace_member\(/i);
  });

  it("🔒 refuses a SHARED CREDENTIAL everything but a `workspace` template — the missing arm 2", () => {
    const fn = liveFunction(READABLE);
    // Arm 1 first, ungated…
    expect(fn).toMatch(/t\.visibility\s*=\s*'workspace'\s*OR\s*\(\s*NOT\s+public\.dopl_credential_is_shared\(\)/i);
    // …and the creator arm strictly INSIDE the guard, which is the whole repair:
    // a credential standing for nobody in particular inherits no one's reach.
    expect(fn).toMatch(
      /NOT\s+public\.dopl_credential_is_shared\(\)[\s\S]*t\.created_by\s*=\s*\(\s*SELECT auth\.uid\(\)\s*\)/i
    );
  });

  it("🔒 carries the GRANT arm, at the TOP and not inside the membership branch (F-604)", () => {
    // ⚠ THE POSITION IS THE ASSERTION. A grantee is typically NOT a member of
    // the resource's container, so an arm nested under
    // `is_current_workspace_member` would be unreachable and the write door
    // B15 shipped would go on writing rows nothing reads.
    const fn = liveFunction(READABLE);
    // It is OR-ed onto a CLOSED membership group…
    expect(fn).toMatch(/\)\s*OR\s+public\.dopl_grant_admits\(\s*'agent_template'/i);
    // …and never AND-ed, which is the nesting failure mode: an arm conjoined
    // with the membership test can only ever narrow, so the grant would do
    // nothing for the caller it is written for.
    expect(fn).not.toMatch(/AND\s+public\.dopl_grant_admits/i);
  });

  it("🔒 `dopl_grant_admits` answers CHANNEL and CONTAINER, and refuses `team`", () => {
    // ⚠ `team` is FALSE here BY DESIGN, not by omission: it is already an arm of
    // `dopl_teams_mode_visible()`, and two rules for one grant is how the second
    // rots. Ruling B4 made team a scope, not a second mechanism.
    const admits = liveFunction("dopl_grant_admits");
    expect(admits).toMatch(/WHEN\s+'container'\s+THEN[\s\S]*?is_current_workspace_member\(\s*g\.scope_id,\s*'viewer'\s*\)/i);
    expect(admits).toMatch(/WHEN\s+'channel'\s+THEN[\s\S]*?level\s*=\s*'visible'[\s\S]*?is_channel_member\(\s*g\.scope_id\s*\)/i);
    expect(admits).toMatch(/ELSE\s+false/i);
    // 🔒 NO `workspace_id` TERM. The row is filed under the RESOURCE's
    // container and the caller reaches it through the SCOPE's — a tenancy term
    // here would refuse exactly the cross-container lend it exists to honour.
    expect(admits).not.toMatch(/g\.workspace_id/i);
  });

  it("keeps the ADMIN arm inside the `team` branch — private means private, admins included", () => {
    const fn = liveFunction(READABLE);
    expect(fn).toMatch(
      /t\.visibility\s*=\s*'team'\s*AND\s*public\.dopl_teams_mode_visible\(/i
    );
    // The admin arm now lives in the shared teams helper rather than being
    // spelled a fourth time here; it is unreachable for a `private` row because
    // the `'team'` term guards the call.
    expect(fn).not.toMatch(/'admin'::text/i);
    // ⚠ Follow the chain: the axis is stated in `dopl_teams_visible_for_user`
    // since F-583 made it answer for a NAMED user, and `dopl_teams_mode_visible`
    // is the caller-scoped case of it.
    expect(liveFunction("dopl_teams_visible_for_user")).toMatch(
      /is_workspace_member\(p_workspace_id, p_user_id, 'admin'\)/i
    );
  });

  it("resolves the teams axis through resource_grants, scope_type and all", () => {
    expect(liveFunction(READABLE)).toContain("'agent_template', t.id");
    // ⚠ Without the `scope_type` term this would answer "is this team template
    // visible to me" with a CHANNEL grant on the same resource (F-468).
    expect(liveFunction("dopl_teams_visible_for_user")).toMatch(
      /FROM\s+public\.resource_grants\s+g\b[\s\S]*?g\.scope_type\s*=\s*'team'/i
    );
  });

  it("fences the KB junction on the template it belongs to", () => {
    const junction =
      POLICIES.get(
        "agent_template_knowledge_bases.agent_template_knowledge_bases_member_select"
      ) ?? "";
    expect(junction).toContain(`${READABLE}(template_id)`);
  });
});

/* ────────────────────────── the live half ────────────────────────── */

describe.skipIf(!liveRedteamEnabled)(
  "REDTEAM agent_templates (live) — the caller client, against a real policy",
  () => {
    let ownerId = "";
    let outsiderId = "";
    let adminId = "";
    let teammateId = "";
    let workspaceId = "";
    let outsiderContainerId = "";
    let teamId = "";
    let workspaceTemplateId = "";
    let privateTemplateId = "";
    let teamTemplateId = "";

    const seed = async (visibility: "workspace" | "private" | "team"): Promise<string> => {
      const repo = await import("./repository");
      const row = await repo.insertTemplate({
        workspaceId,
        name: visibility,
        description: null,
        instructions: null,
        model: null,
        fields: [],
        visibility,
        createdBy: ownerId,
      });
      return row.id;
    };

    beforeAll(async () => {
      ownerId = await makeUser("owner");
      outsiderId = await makeUser("outsider");
      adminId = await makeUser("admin");
      teammateId = await makeUser("teammate");
      workspaceId = await makeWorkspace(ownerId);
      await addMember(workspaceId, adminId, "admin");
      await addMember(workspaceId, teammateId, "member");
      teamId = await makeTeam(workspaceId, teammateId);
      // The BORROWING container: the outsider owns it, and the grantor is a
      // member so the validity trigger will accept a grant into it.
      outsiderContainerId = await makeWorkspace(outsiderId);
      await addMember(outsiderContainerId, ownerId, "member");

      workspaceTemplateId = await seed("workspace");
      privateTemplateId = await seed("private");
      teamTemplateId = await seed("team");
      await grantToScope({
        workspaceId,
        scopeType: "team",
        scopeId: teamId,
        resourceType: "agent_template",
        resourceId: teamTemplateId,
        createdBy: ownerId,
      });
    }, 60_000);

    afterAll(async () => {
      await deleteWorkspace(workspaceId);
      await deleteWorkspace(outsiderContainerId);
      await deleteUsers([ownerId, outsiderId, adminId, teammateId]);
    }, 60_000);

    // ⚠ `agent_template_knowledge_bases` has no live case of its own: its policy
    // IS `can_current_user_read_agent_template`, applied to `template_id`, so
    // every verdict below is its verdict too. Seeding it would need a knowledge
    // base, i.e. another feature's fixture, for no additional evidence.

    it("a NON-MEMBER sees zero rows", async () => {
      expect(await readableIds(outsiderId, "agent_templates", workspaceId)).toHaveLength(0);
    });

    it("🔒 a SHARED CREDENTIAL on the owner's id sees the WORKSPACE template and nothing else", async () => {
      const ids = await readableIds(ownerId, "agent_templates", workspaceId, { shared: true });
      expect(ids).toEqual([workspaceTemplateId]);
    });

    it("an ADMIN sees the team template and NOT the owner's private one", async () => {
      const ids = await readableIds(adminId, "agent_templates", workspaceId);
      expect(ids).toContain(teamTemplateId);
      expect(ids).not.toContain(privateTemplateId);
    });

    it("a member of the granted team sees the team template; the grant is what does it", async () => {
      expect(await readableIds(teammateId, "agent_templates", workspaceId)).toContain(
        teamTemplateId
      );
    });

    it("🔒 GRANTED INTO A CONTAINER → visible to that container's members; REVOKED → invisible (F-604)", async () => {
      // The whole of ruling B11 in one case: a `private` template in the
      // owner's workspace, lent to a container the OUTSIDER is a member of.
      // Before the grant that reader is the "sees zero rows" case above.
      const ref = {
        workspaceId,
        scopeType: "container" as const,
        scopeId: outsiderContainerId,
        resourceType: "agent_template" as const,
        resourceId: privateTemplateId,
      };
      // ⚠ THE GRANTOR IS IN BOTH ROOMS, because `enforce_resource_grant` says
      // so — cross-container reach requires a NAMED grantor who could lend it
      // OUT and lend it IN (`20260914120000` rule 4).
      await grantToScope({ ...ref, createdBy: ownerId });
      expect(
        await readableIds(outsiderId, "agent_templates", workspaceId)
      ).toEqual([privateTemplateId]);

      // 🔒 AND THE OTHER HALF, WHICH IS WHERE A `true` PREDICATE WOULD SHOW.
      await revokeFromScope(ref);
      expect(
        await readableIds(outsiderId, "agent_templates", workspaceId)
      ).toHaveLength(0);
    });
  }
);
