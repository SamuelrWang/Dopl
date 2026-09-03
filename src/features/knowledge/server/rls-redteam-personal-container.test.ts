import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { supabaseAdmin } from "@/shared/supabase/admin";
import { generatePublicId } from "@/shared/lib/id/public-id";
import {
  deleteUsers,
  deleteWorkspace,
  liveRedteamEnabled,
  makeUser,
  readableIds,
} from "@/shared/supabase/rls-redteam-fixture";

/**
 * 🔒 **THE PERSONAL CONTAINER, READ THROUGH A CONTAINER LOCK** — the SQL half of
 * the 1.26.0 smoke fix, and the reason that fix ships no policy change.
 *
 * ⚠ **THE LOCK IS NOT A POLICY INPUT AND MUST NOT BECOME ONE.**
 * `rls-redteam-resource-grants.test.ts` pins that no SELECT policy reads
 * `dopl_credential.workspace_id`: tenancy comes from `workspace_members`, which
 * no caller-supplied claim can widen, and the lock is enforced at the ROUTE
 * (`with-workspace-auth.ts`, `segment.ts › withinKeyLock`). So the database has
 * always admitted the operator's own personal base to their own locked
 * credential, and `resolve-resource.ts` was the narrow half. **These three cases
 * are what makes that a measurement rather than an argument** — without them the
 * claim "the twin already agrees, so there is no migration" rests on reading the
 * SQL rather than on running it.
 *
 * ⚠ Every scope this fixture mints carries a FOREIGN container id
 * (`rls-redteam-fixture.ts › scopeFor`), so each case below is genuinely a
 * LOCKED credential reading outside its lock.
 */
describe.skipIf(!liveRedteamEnabled)(
  "REDTEAM (live) — a locked credential and its operator's PERSONAL container",
  () => {
    let ownerId = "";
    let strangerId = "";
    let personalId = "";
    let strangerPersonalId = "";
    let myBaseId = "";
    let strangerBaseId = "";

    /** The container through `ensure_personal_container`, never a hand-built
     *  row: the owner membership and the partial unique index are the mint's,
     *  and a fixture that invented them would prove something else. */
    async function mintPersonal(userId: string): Promise<string> {
      const { data, error } = await supabaseAdmin().rpc(
        "ensure_personal_container",
        { p_owner_id: userId, p_public_id: generatePublicId() }
      );
      if (error) throw error;
      return (data as Array<{ id: string }>)[0].id;
    }

    beforeAll(async () => {
      ownerId = await makeUser("shelf-owner");
      strangerId = await makeUser("shelf-stranger");
      personalId = await mintPersonal(ownerId);
      strangerPersonalId = await mintPersonal(strangerId);
      const repo = await import("./repository");
      myBaseId = (
        await repo.insertBase({
          workspaceId: personalId,
          name: "Orchestration Guidelines",
          slug: "orchestration-guidelines",
          visibility: "private",
          createdBy: ownerId,
        })
      ).id;
      strangerBaseId = (
        await repo.insertBase({
          workspaceId: strangerPersonalId,
          name: "Their Notes",
          slug: "their-notes",
          visibility: "private",
          createdBy: strangerId,
        })
      ).id;
    }, 60_000);

    afterAll(async () => {
      await deleteWorkspace(personalId);
      await deleteWorkspace(strangerPersonalId);
      await deleteUsers([ownerId, strangerId]);
    }, 60_000);

    it("locked WITH A SUBJECT reads its own personal base — 1 row", async () => {
      expect(
        await readableIds(ownerId, "knowledge_bases", personalId)
      ).toEqual([myBaseId]);
    });

    it("🔒 a locked SHARED credential reads it not at all — 0 rows", async () => {
      // M-10: a credential that may be passed between humans stands for nobody,
      // so `created_by = auth.uid()` is not enough on a private row.
      expect(
        await readableIds(ownerId, "knowledge_bases", personalId, {
          shared: true,
        })
      ).toHaveLength(0);
    });

    it("🔒 and reads ANOTHER user's personal base not at all — 0 rows", async () => {
      // ⚠ The shelf is a container with exactly one member, so this is the
      // ordinary non-member refusal — which is the point: admitting the
      // caller's OWN container to the id lane borrows no reach into anyone
      // else's, because the lookup is keyed on the owner.
      expect(
        await readableIds(ownerId, "knowledge_bases", strangerPersonalId)
      ).toHaveLength(0);
      expect(
        await readableIds(strangerId, "knowledge_bases", strangerPersonalId)
      ).toEqual([strangerBaseId]);
    });
  }
);
