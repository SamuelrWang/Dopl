/**
 * REDTEAM — `channel_tasks` (migration `20261121190000`, PLAN.md R6). The parent's one policy is
 * the realtime doorbell's fence and must admit exactly who reads the channel's messages: members,
 * public-channel readers at viewer+, and a guest only in a channel it belongs to. The three children
 * carry no policy and no `authenticated` privilege at all.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { livePolicies, liveRlsEnabled } from "@/shared/supabase/rls-policy-scan";
import { supabaseAdmin } from "@/shared/supabase/admin";
import {
  addMember,
  callerClient,
  deleteUsers,
  deleteWorkspace,
  liveRedteamEnabled,
  makeUser,
  makeWorkspace,
  readableIds,
} from "@/shared/supabase/rls-redteam-fixture";

const POLICIES = livePolicies();
const CHILDREN = ["channel_task_subtasks", "channel_task_notes", "channel_task_assignees"];

describe("REDTEAM channel_tasks — the policies alone", () => {
  it("RLS is on for the parent and all three children", () => {
    const enabled = liveRlsEnabled();
    for (const t of ["channel_tasks", ...CHILDREN]) expect(enabled.has(t), t).toBe(true);
  });

  it("the parent has one SELECT policy carrying the viewer arm and the public-free guest arm", () => {
    const keys = [...POLICIES.keys()].filter((k) => k.startsWith("channel_tasks."));
    expect(keys).toEqual(["channel_tasks.channel_tasks_member_select"]);
    const body = POLICIES.get(keys[0]) ?? "";
    expect(body).toMatch(/is_current_workspace_member\(workspace_id, 'viewer'\)/);
    expect(body).toMatch(/is_current_workspace_member\(workspace_id, 'guest'\)/);
    // The guest disjunct must not inherit the public arm.
    const guestArm = body.slice(body.indexOf("'guest'"));
    expect(guestArm).not.toMatch(/visibility = 'public'/);
  });

  it("the children carry no policy", () => {
    for (const t of CHILDREN) {
      expect([...POLICIES.keys()].filter((k) => k.startsWith(`${t}.`)), t).toEqual([]);
    }
  });
});

/* ────────────────────────── the live half ────────────────────────── */

describe.skipIf(!liveRedteamEnabled)("REDTEAM channel_tasks (live) — the caller client", () => {
  const admin = () => supabaseAdmin();
  let ownerId = "";
  let viewerId = "";
  let guestId = "";
  let strangerGuestId = "";
  let outsiderId = "";
  let workspaceId = "";
  let privateTask = "";
  let publicTask = "";
  let guestTask = "";

  async function channel(visibility: "public" | "private", members: string[]): Promise<string> {
    const { data, error } = await admin()
      .from("channels")
      .insert({
        workspace_id: workspaceId,
        name: `redteam ${visibility}`,
        slug: `redteam-${visibility}-${Math.random().toString(36).slice(2)}`,
        visibility,
        created_by: ownerId,
      })
      .select("id")
      .single();
    if (error || !data) throw error ?? new Error("no channel");
    for (const userId of members) {
      const m = await admin()
        .from("channel_members")
        .insert({ channel_id: data.id, workspace_id: workspaceId, user_id: userId });
      if (m.error) throw m.error;
    }
    return data.id;
  }

  async function task(channelId: string): Promise<string> {
    const { data, error } = await admin()
      .from("channel_tasks")
      .insert({ channel_id: channelId, workspace_id: workspaceId, title: "t", created_by: ownerId })
      .select("id")
      .single();
    if (error || !data) throw error ?? new Error("no task");
    const note = await admin()
      .from("channel_task_notes")
      .insert({ task_id: data.id, author_user_id: ownerId, body: "n" });
    if (note.error) throw note.error;
    return data.id;
  }

  beforeAll(async () => {
    ownerId = await makeUser("owner");
    viewerId = await makeUser("viewer");
    guestId = await makeUser("guest");
    strangerGuestId = await makeUser("stranger-guest");
    outsiderId = await makeUser("outsider");
    workspaceId = await makeWorkspace(ownerId);
    await addMember(workspaceId, viewerId, "viewer");
    await addMember(workspaceId, guestId, "guest");
    await addMember(workspaceId, strangerGuestId, "guest");
    privateTask = await task(await channel("private", [ownerId]));
    publicTask = await task(await channel("public", [ownerId]));
    guestTask = await task(await channel("private", [ownerId, guestId]));
  }, 60_000);

  afterAll(async () => {
    await deleteWorkspace(workspaceId);
    await deleteUsers([ownerId, viewerId, guestId, strangerGuestId, outsiderId]);
  }, 60_000);

  it("a member sees every task in the channels they belong to", async () => {
    const ids = await readableIds(ownerId, "channel_tasks", workspaceId);
    expect(ids.sort()).toEqual([privateTask, publicTask, guestTask].sort());
  });

  it("a viewer outside a private channel sees only the public channel's task", async () => {
    expect(await readableIds(viewerId, "channel_tasks", workspaceId)).toEqual([publicTask]);
  });

  it("🔒 a guest sees its own channel's task and NOT the public one", async () => {
    expect(await readableIds(guestId, "channel_tasks", workspaceId)).toEqual([guestTask]);
    expect(await readableIds(strangerGuestId, "channel_tasks", workspaceId)).toEqual([]);
  });

  it("a non-member of the workspace sees nothing", async () => {
    expect(await readableIds(outsiderId, "channel_tasks", workspaceId)).toEqual([]);
  });

  it.each(CHILDREN)("🔒 %s returns no row even to the task's own member", async (table) => {
    const { data } = await callerClient(ownerId).from(table).select("id");
    expect(data ?? []).toEqual([]);
  });

  it("🔒 a member cannot write the parent through PostgREST", async () => {
    const { error } = await callerClient(ownerId)
      .from("channel_tasks")
      .update({ title: "hijacked" })
      .eq("id", guestTask);
    expect(error).not.toBeNull();
  });
});
