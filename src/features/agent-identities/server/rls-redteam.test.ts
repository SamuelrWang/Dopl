/**
 * The policy alone refuses what `service-shared.ts › canSeeIdentity` refuses, arm for arm: arm 1
 * (`workspace`) before the shared-credential guard, the admin arm inside the `team` branch. Structural
 * half: `shared/supabase/rls-policy-scan.ts` (F-523); live half: `shared/supabase/rls-redteam-fixture.ts`.
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

/** The matrix as one SQL predicate. */
const READABLE = "can_current_user_read_agent_identity";

/** The membership group closed, then the shared-credential refusal AND the grant (twin of `knowledge/server/rls-redteam.test.ts › GRANT_ARM`). */
const GRANT_ARM =
  /\) OR \( NOT public\.dopl_credential_is_shared\(\) AND public\.dopl_grant_admits\(\s*'agent_identity', t\.id\s*\) \)/i;

describe("REDTEAM agent_identities — the policy alone", () => {
  const policy = () => POLICIES.get("agent_identities.agent_identities_member_select") ?? "";

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

  it("refuses a SHARED CREDENTIAL everything but a `workspace` identity — the missing arm 2", () => {
    const fn = liveFunction(READABLE);
    expect(fn).toMatch(/t\.visibility\s*=\s*'workspace'\s*OR\s*\(\s*NOT\s+public\.dopl_credential_is_shared\(\)/i);
    // The creator arm inside the guard: a credential standing for nobody inherits no one's reach.
    expect(fn).toMatch(
      /NOT\s+public\.dopl_credential_is_shared\(\)[\s\S]*t\.created_by\s*=\s*\(\s*SELECT auth\.uid\(\)\s*\)/i
    );
  });

  it("carries the GRANT arm BESIDE the membership branch, never inside it", () => {
    // A grantee is typically not a member of the resource's container, so a nested arm is unreachable.
    const fn = liveFunction(READABLE);
    expect(fn).toMatch(GRANT_ARM);
    expect(fn).not.toMatch(
      /is_current_workspace_member\([^)]*\)\s*AND\s+public\.dopl_grant_admits/i,
    );
  });

  it("…and the arm carries arm 2 with it — a SHARED credential is not widened", () => {
    // `canSeeIdentity` asks `isSharedCredential` before it consults grants; the policy must too.
    expect(liveFunction(READABLE)).toMatch(
      /NOT public\.dopl_credential_is_shared\(\) AND public\.dopl_grant_admits\(\s*'agent_identity'/i,
    );
  });

  it("`dopl_grant_admits` answers CHANNEL and CONTAINER, and refuses `team`", () => {
    // `team` is false by design: it is already an arm of `dopl_teams_mode_visible()`.
    const admits = liveFunction("dopl_grant_admits");
    expect(admits).toMatch(/WHEN\s+'container'\s+THEN[\s\S]*?is_current_workspace_member\(\s*g\.scope_id,\s*'viewer'\s*\)/i);
    expect(admits).toMatch(/WHEN\s+'channel'\s+THEN[\s\S]*?level\s*=\s*'visible'[\s\S]*?is_channel_member\(\s*g\.scope_id\s*\)/i);
    expect(admits).toMatch(/ELSE\s+false/i);
    // No `workspace_id` term: the caller reaches the resource's container through the scope's.
    expect(admits).not.toMatch(/g\.workspace_id/i);
  });

  it("keeps the ADMIN arm inside the `team` branch — private means private, admins included", () => {
    const fn = liveFunction(READABLE);
    expect(fn).toMatch(
      /t\.visibility\s*=\s*'team'\s*AND\s*public\.dopl_teams_mode_visible\(/i
    );
    // The admin arm lives in the teams helper, guarded by the `'team'` term.
    expect(fn).not.toMatch(/'admin'::text/i);
    // `dopl_teams_mode_visible` is the caller-scoped case of `dopl_teams_visible_for_user` (F-583).
    expect(liveFunction("dopl_teams_visible_for_user")).toMatch(
      /is_workspace_member\(p_workspace_id, p_user_id, 'admin'\)/i
    );
  });

  it("resolves the teams axis through resource_grants, scope_type and all", () => {
    expect(liveFunction(READABLE)).toContain("'agent_identity', t.id");
    // Without `scope_type`, a channel grant on the same resource would answer the team question (F-468).
    expect(liveFunction("dopl_teams_visible_for_user")).toMatch(
      /FROM\s+public\.resource_grants\s+g\b[\s\S]*?g\.scope_type\s*=\s*'team'/i
    );
  });

  it("fences the KB junction on the identity it belongs to", () => {
    const junction =
      POLICIES.get(
        "agent_identity_knowledge_bases.agent_identity_knowledge_bases_member_select"
      ) ?? "";
    expect(junction).toContain(`${READABLE}(identity_id)`);
  });
});

describe.skipIf(!liveRedteamEnabled)(
  "REDTEAM agent_identities (live) — the caller client, against a real policy",
  () => {
    let ownerId = "";
    let outsiderId = "";
    let adminId = "";
    let teammateId = "";
    let workspaceId = "";
    let outsiderContainerId = "";
    let teamId = "";
    let workspaceIdentityId = "";
    let privateIdentityId = "";
    let teamIdentityId = "";

    const seed = async (visibility: "workspace" | "private" | "team"): Promise<string> => {
      const repo = await import("./repository");
      const row = await repo.insertIdentity({
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

    /** The owner's private identity, lent into a container the outsider is a member of. */
    const lendToOutsider = () => ({
      workspaceId,
      scopeType: "container" as const,
      scopeId: outsiderContainerId,
      resourceType: "agent_identity" as const,
      resourceId: privateIdentityId,
    });

    beforeAll(async () => {
      ownerId = await makeUser("owner");
      outsiderId = await makeUser("outsider");
      adminId = await makeUser("admin");
      teammateId = await makeUser("teammate");
      workspaceId = await makeWorkspace(ownerId);
      await addMember(workspaceId, adminId, "admin");
      await addMember(workspaceId, teammateId, "member");
      teamId = await makeTeam(workspaceId, teammateId);
      // The borrowing container; the grantor must be a member for the validity trigger to accept a grant.
      outsiderContainerId = await makeWorkspace(outsiderId);
      await addMember(outsiderContainerId, ownerId, "member");

      workspaceIdentityId = await seed("workspace");
      privateIdentityId = await seed("private");
      teamIdentityId = await seed("team");
      await grantToScope({
        workspaceId,
        scopeType: "team",
        scopeId: teamId,
        resourceType: "agent_identity",
        resourceId: teamIdentityId,
        createdBy: ownerId,
      });
    }, 60_000);

    afterAll(async () => {
      await deleteWorkspace(workspaceId);
      await deleteWorkspace(outsiderContainerId);
      await deleteUsers([ownerId, outsiderId, adminId, teammateId]);
    }, 60_000);

    // The KB junction's policy is the same predicate on `identity_id`, so these verdicts are its verdicts.

    it("a NON-MEMBER sees zero rows", async () => {
      expect(await readableIds(outsiderId, "agent_identities", workspaceId)).toHaveLength(0);
    });

    it("a SHARED CREDENTIAL on the owner's id sees the WORKSPACE identity and nothing else", async () => {
      const ids = await readableIds(ownerId, "agent_identities", workspaceId, { shared: true });
      expect(ids).toEqual([workspaceIdentityId]);
    });

    it("an ADMIN sees the team identity and NOT the owner's private one", async () => {
      const ids = await readableIds(adminId, "agent_identities", workspaceId);
      expect(ids).toContain(teamIdentityId);
      expect(ids).not.toContain(privateIdentityId);
    });

    it("a member of the granted team sees the team identity; the grant is what does it", async () => {
      expect(await readableIds(teammateId, "agent_identities", workspaceId)).toContain(
        teamIdentityId
      );
    });

    it("GRANTED INTO A CONTAINER → visible to that container's members; REVOKED → invisible", async () => {
      const ref = lendToOutsider();
      // `enforce_resource_grant` requires a grantor in both containers (`20260914120000` rule 4).
      await grantToScope({ ...ref, createdBy: ownerId });
      expect(
        await readableIds(outsiderId, "agent_identities", workspaceId)
      ).toEqual([privateIdentityId]);

      // Revocation is where a constant-`true` predicate would show.
      await revokeFromScope(ref);
      expect(
        await readableIds(outsiderId, "agent_identities", workspaceId)
      ).toHaveLength(0);
    });

    it("a SHARED CREDENTIAL is not widened by that grant, live", async () => {
      // Only the credential kind moves; `canSeeIdentity` refuses at arm 2.
      const ref = lendToOutsider();
      await grantToScope({ ...ref, createdBy: ownerId });
      try {
        expect(
          await readableIds(outsiderId, "agent_identities", workspaceId)
        ).toEqual([privateIdentityId]);
        expect(
          await readableIds(outsiderId, "agent_identities", workspaceId, {
            shared: true,
          })
        ).toHaveLength(0);
      } finally {
        await revokeFromScope(ref);
      }
    });
  }
);
