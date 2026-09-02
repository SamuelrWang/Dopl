/**
 * REDTEAM — the POLICIES, alone, refuse what `service-shared.ts › canSeeChat`
 * refuses (Wave B B12; Samuel's ruling B5, "RLS is the fence").
 *
 * 🔒 CHATS IS THE TABLE THIS WHOLE PLAN IS NAMED AFTER.
 * `20260716150000_chats_team_aware_rls.sql` exists because RLS stayed permissive
 * after the service tightened and a team-scoped transcript leaked through
 * PostgREST to every member for as long as nobody compared the two. Two more
 * gaps of the same shape survived until `20260921120000`:
 *
 *   * **`chats_member_select` led with a blanket admin arm**, so a workspace
 *     admin read every PRIVATE transcript. `canSeeChat` returns false for
 *     `visibility !== "public"` BEFORE its admin arm, so the API has never
 *     returned those rows — the policy was alone in believing it.
 *     `20260916120000`'s probe P2 records the arm as deliberate; ruling B5 asks
 *     the policy to EQUAL the predicate, and `agent_templates` had already made
 *     exactly this correction (`20260915120000`: *"the admin arm is INSIDE the
 *     'team' branch … moving it out is a widening"*).
 *   * **`chats_owner_select` was an unfenced `owner_id = auth.uid()`** — no
 *     membership floor, no credential axis. ⚠ REPAIRING ONE OF A PAIR CHANGES
 *     NOTHING: permissive policies are OR-ed, so both now call the one
 *     predicate, and the first assertion below is the one that keeps it that
 *     way.
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
} from "@/shared/supabase/rls-redteam-fixture";

const POLICIES = livePolicies();

/** "May the caller read this chat?" — the rule, written once. */
const READABLE = "dopl_chat_readable";
/** The `public`/`teams` matrix `canSeeChat` and `canSeeSkill` share. */
const MATRIX = "dopl_public_teams_admits";

/** ⚠ EVERY permissive SELECT policy on `chats`, not just the one being edited. */
const CHAT_POLICIES = ["chats.chats_owner_select", "chats.chats_member_select"];

describe("REDTEAM chats — the policies alone", () => {
  it("🔒 BOTH policies defer to the one predicate — an OR-ed pair is one fence", () => {
    for (const key of CHAT_POLICIES) {
      expect(POLICIES.get(key)).toContain(`${READABLE}(id)`);
    }
  });

  it("refuses an ADMIN a member's PRIVATE transcript — the arm that was blanket", () => {
    for (const key of CHAT_POLICIES) {
      // The blanket arm was `is_current_workspace_member(workspace_id,'admin')`
      // at the TOP of the body. Neither policy states any admin arm now; the
      // only one left is inside `dopl_teams_mode_visible`, reached only after
      // `p_visibility = 'public'` has held.
      expect(POLICIES.get(key)).not.toMatch(/'admin'/i);
    }
    expect(liveFunction(MATRIX)).toMatch(
      /p_visibility\s*=\s*'public'\s*AND\s*public\.dopl_teams_mode_visible/i
    );
  });

  it("refuses a NON-MEMBER, in the caller-pinned form", () => {
    expect(liveFunction(READABLE)).toMatch(
      /is_current_workspace_member\(\s*c\.workspace_id,\s*'viewer'\s*\)/i
    );
    expect(liveFunction(READABLE)).not.toMatch(/[^_]is_workspace_member\(/i);
  });

  it("refuses a SHARED CREDENTIAL a private transcript, and keys the owner arm on owner_id", () => {
    expect(liveFunction(MATRIX)).toMatch(/NOT\s+public\.dopl_credential_is_shared\(\)/i);
    // ⚠ `owner_id`, not `created_by` — the one column-name difference between
    // this table and `skills`, and the reason the matrix takes parameters
    // instead of being copied.
    expect(liveFunction(READABLE)).toContain("c.owner_id");
    expect(liveFunction(READABLE)).toContain("'chat', c.id");
  });

  it("fences the CHILD table on the parent — a message is readable when its chat is", () => {
    // ⚠ NOT DECORATIVE: `chats/server/repository.ts › listVisibleChats` selects
    // `*, chat_messages(count)`, so under a caller-scoped client this policy
    // filters an EMBEDDED count. A wider child publishes the length of a
    // transcript the caller may not read.
    const messages = POLICIES.get("chat_messages.chat_messages_select") ?? "";
    expect(messages).toContain(`${READABLE}(chat_id)`);
    expect(messages).not.toMatch(/visibility\s*=/i);
    expect(messages).not.toMatch(/'admin'/i);
  });
});

/* ────────────────────────── the live half ────────────────────────── */

describe.skipIf(!liveRedteamEnabled)(
  "REDTEAM chats (live) — the caller client, against a real policy",
  () => {
    let ownerId = "";
    let outsiderId = "";
    let adminId = "";
    let teammateId = "";
    let workspaceId = "";
    let teamId = "";
    let publicChatId = "";
    let privateChatId = "";
    let teamChatId = "";

    const seed = async (
      visibility: "public" | "private",
      accessMode: "workspace" | "teams"
    ): Promise<string> => {
      const repo = await import("./repository");
      const row = await repo.createChatWithMessages(
        {
          workspace_id: workspaceId,
          owner_id: ownerId,
          folder_id: null,
          client_session_id: null,
          visibility,
          access_mode: accessMode,
          title: `${visibility}/${accessMode}`,
          format: "markdown",
        },
        [{ role: "user", summary: "hello", verbatim: null }]
      );
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

      publicChatId = await seed("public", "workspace");
      privateChatId = await seed("private", "workspace");
      teamChatId = await seed("public", "teams");
      await grantToScope({
        workspaceId,
        scopeType: "team",
        scopeId: teamId,
        resourceType: "chat",
        resourceId: teamChatId,
        createdBy: ownerId,
      });
    }, 60_000);

    afterAll(async () => {
      await deleteWorkspace(workspaceId);
      await deleteUsers([ownerId, outsiderId, adminId, teammateId]);
    }, 60_000);

    it.each(["chats", "chat_messages"])("%s: a NON-MEMBER sees zero rows", async (table) => {
      expect(await readableIds(outsiderId, table, workspaceId)).toHaveLength(0);
    });

    it("🔒 an ADMIN does NOT see the owner's private chat, and does see the public one", async () => {
      const ids = await readableIds(adminId, "chats", workspaceId);
      expect(ids).toContain(publicChatId);
      expect(ids).not.toContain(privateChatId);
    });

    it("🔒 a SHARED CREDENTIAL on the owner's id sees the public chat and NOT the private one", async () => {
      const ids = await readableIds(ownerId, "chats", workspaceId, { shared: true });
      expect(ids).toContain(publicChatId);
      expect(ids).not.toContain(privateChatId);
    });

    it("a TEAMMATE with a grant sees the teams-mode chat; an admin without one does too", async () => {
      expect(await readableIds(teammateId, "chats", workspaceId)).toContain(teamChatId);
      // The admin arm survives INSIDE the team branch — administering sharing.
      expect(await readableIds(adminId, "chats", workspaceId)).toContain(teamChatId);
    });

    it("a member in NO granted team does not see the teams-mode chat", async () => {
      expect(await readableIds(outsiderId, "chats", workspaceId)).not.toContain(teamChatId);
    });
  }
);
