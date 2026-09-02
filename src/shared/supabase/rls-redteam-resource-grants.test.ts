/**
 * REDTEAM — `resource_grants`, the table every other policy leans on, and the
 * two claims the minted caller JWT is allowed to make (Wave B B12; ruling B5).
 *
 * 🔒 WHY THIS TABLE GETS ITS OWN SUITE AND NO REWRITE.
 * `resource_grants_member_select` (`20260914120000`) is the one SELECT policy in
 * the covered set that was written THIS WAVE with the caller lane already in
 * mind: it carries the workspace floor, the guest arm and the channel-scope
 * narrowing. So phase 2 covers it by moving its reads onto the caller client, by
 * this suite, and by a pair-gate row — not by a repair it does not need. A
 * suite that asserted nothing here would leave the seventh table covered on
 * paper only.
 *
 * 🔒 AND IT IS WHERE THE CREDENTIAL AXES ARE PINNED. `caller-jwt.ts` mints TWO
 * facts into every token — `shared` (WHOSE reach, the M-10 axis) and
 * `workspace_id` (WHICH container, the LOCK). Only the first is a policy input.
 * The second is enforced at the route (`with-workspace-auth.ts`,
 * `workspaces/server/segment.ts › withinKeyLock`); a policy that read it would
 * be deriving membership from a claim instead of from `workspace_members`, and
 * `is_current_workspace_member` exists precisely so that no caller-supplied
 * value can widen a read. The last two cases are what would notice.
 *
 * ⚠ TWO HALVES; see `./rls-policy-scan.ts` (what a structural assertion proves,
 * F-523) and `./rls-redteam-fixture.ts` (why the live half is skipped).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { livePolicies, liveFunction } from "./rls-policy-scan";
import { DOPL_CREDENTIAL_CLAIM } from "./caller-jwt";
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
} from "./rls-redteam-fixture";

const POLICIES = livePolicies();
const GRANTS = "resource_grants.resource_grants_member_select";

describe("REDTEAM resource_grants — the policy alone", () => {
  const policy = () => POLICIES.get(GRANTS) ?? "";

  it("floors every read at workspace membership, in the caller-pinned form", () => {
    expect(policy()).toMatch(/is_current_workspace_member\(workspace_id, 'viewer'\)/i);
    expect(policy()).not.toMatch(/[^_]is_workspace_member\(/i);
  });

  it("🔒 gives a GUEST a grant row only inside a channel they are a member of", () => {
    // The guest floor is a RANK failure everywhere else (guest = -1, viewer = 0,
    // `20260825140000_guest_role.sql`); this is the one table where a guest is
    // admitted at all, and only through their own channel membership.
    expect(policy()).toMatch(
      /is_current_workspace_member\(workspace_id, 'guest'\)\s*AND\s*scope_type\s*=\s*'channel'\s*AND\s*is_channel_member\(scope_id\)/i
    );
  });

  it("hides a CHANNEL grant that is not `visible` from everyone but an admin", () => {
    expect(policy()).toMatch(/scope_type\s*<>\s*'channel'\s*OR\s*level\s*=\s*'visible'/i);
    expect(policy()).toMatch(/is_current_workspace_member\(workspace_id, 'admin'\)/i);
  });
});

describe("REDTEAM the caller JWT — one claim is a policy input, the other is not", () => {
  it("the claim the SQL reads is the claim the mint writes", () => {
    // Drift here is silent and one-directional: a renamed claim reads as
    // ABSENT, absent reads as "not shared", and every shared credential quietly
    // becomes a person again.
    expect(liveFunction("dopl_credential_is_shared")).toContain(`'${DOPL_CREDENTIAL_CLAIM}'`);
  });

  it("🔒 and `shared` is the ONLY thing any policy reads out of it", () => {
    expect(liveFunction("dopl_credential_is_shared")).toMatch(/->>\s*'shared'/i);
    expect(liveFunction("dopl_credential_is_shared")).not.toMatch(/workspace_id/i);
  });

  it("🔒 no SELECT policy reads the claim directly — the CONTAINER LOCK is not a policy input", () => {
    // A policy that asked `auth.jwt() -> 'dopl_credential' ->> 'workspace_id'`
    // would be deriving tenancy from a claim rather than from `workspace_members`.
    // Every policy reaches the axis through the helper above, or not at all.
    const offenders = [...POLICIES.entries()]
      .filter(([, body]) => /dopl_credential/i.test(body))
      .map(([key]) => key);
    expect(offenders).toEqual([]);
  });
});

/* ────────────────────────── the live half ────────────────────────── */

describe.skipIf(!liveRedteamEnabled)(
  "REDTEAM resource_grants (live) — the caller client, against a real policy",
  () => {
    let ownerId = "";
    let outsiderId = "";
    let guestId = "";
    let teammateId = "";
    let workspaceId = "";
    let teamId = "";

    beforeAll(async () => {
      ownerId = await makeUser("owner");
      outsiderId = await makeUser("outsider");
      guestId = await makeUser("guest");
      teammateId = await makeUser("teammate");
      workspaceId = await makeWorkspace(ownerId);
      await addMember(workspaceId, guestId, "guest");
      await addMember(workspaceId, teammateId, "member");
      teamId = await makeTeam(workspaceId, teammateId);
      await grantToScope({
        workspaceId,
        scopeType: "team",
        scopeId: teamId,
        // ⚠ A grant row carries a POLYMORPHIC `resource_id` with no foreign key,
        // so the fixture does not need the resource to exist to test the grant
        // table's own policy.
        resourceType: "skill",
        resourceId: teamId,
        createdBy: ownerId,
      });
    }, 60_000);

    afterAll(async () => {
      await deleteWorkspace(workspaceId);
      await deleteUsers([ownerId, outsiderId, guestId, teammateId]);
    }, 60_000);

    it("a NON-MEMBER sees zero grant rows", async () => {
      expect(await readableIds(outsiderId, "resource_grants", workspaceId)).toHaveLength(0);
    });

    it("a MEMBER sees the team grant — the row the teams axis resolves through", async () => {
      expect(await readableIds(teammateId, "resource_grants", workspaceId)).toHaveLength(1);
    });

    it("a GUEST sees zero — the guest arm admits CHANNEL scopes only", async () => {
      expect(await readableIds(guestId, "resource_grants", workspaceId)).toHaveLength(0);
    });
  }
);
