/**
 * `removeWorkspaceDepartedMember` — C-20's sweep half.
 *
 * Three things are pinned here, and they are the three things a future edit is
 * most likely to get wrong.
 *
 * 1. THE ROW IS GONE, NOT FILTERED. Samuel, 2026-08-10: "if someone leaves a
 *    workspace, it shouldn't just be a filter but they need to definitely be
 *    removed. Fully and cleanly removed." So the roster read and the member
 *    COUNT are asserted against a store the sweep actually mutated, not against
 *    a mock's call list — a filter added somewhere downstream would pass a
 *    call-count assertion and fail this one. The count matters twice over:
 *    `classify`'s implicit trigger keys on a known-exact `memberCount === 2`
 *    (ENGINEERING §8), so a ghost row is not cosmetic, it is a disabled trigger.
 *
 * 2. THE DM BRANCH. A 1:1 whose peer left is CLOSED (`deleted_at`) as well as
 *    emptied, because a one-member DM renders as a conversation with yourself
 *    (`buildDirectPeers` falls back to `ids[0]`) and auto-addresses nobody
 *    (`resolveDirectPeer` needs exactly two). Group channels get no such stamp.
 *
 * 3. THE ORDER, which is crash-safety: close before delete. Interrupted the
 *    other way round leaves the stranded one-member DM the branch exists to
 *    prevent.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./repository");

import * as repo from "./repository";
import { removeWorkspaceDepartedMember } from "./service-workspace-departure";
import type { ChannelMemberRow, ChannelRow } from "./dto";

const WS = "11111111-e29b-41d4-a716-446655440000";
const LEAVER = "22222222-e29b-41d4-a716-446655440000";
const SURVIVOR = "33333333-e29b-41d4-a716-446655440000";

const ROOM = "chan-room";
const DM = "chan-dm";
const CLOSED_DM = "chan-dm-closed";
const PUBLIC_ELSEWHERE = "chan-public-not-mine";

function channelRow(id: string, over: Partial<ChannelRow> = {}): ChannelRow {
  return {
    id,
    workspace_id: WS,
    created_by: SURVIVOR,
    slug: id,
    name: id,
    topic: "",
    visibility: "private",
    is_direct: false,
    direct_key: null,
    archived_at: null,
    deleted_at: null,
    created_at: "2026-08-10T00:00:00Z",
    updated_at: "2026-08-10T00:00:00Z",
    ...over,
  };
}

function memberRow(channelId: string, userId: string): ChannelMemberRow {
  return {
    channel_id: channelId,
    user_id: userId,
    workspace_id: WS,
    role: "member",
    last_read_at: null,
    agent_tool_profile: "full",
    added_by: SURVIVOR,
    joined_at: "2026-08-10T00:00:00Z",
  } as ChannelMemberRow;
}

/**
 * The world the sweep runs against, as MUTABLE STATE rather than canned
 * returns: `deleteMember` really removes from `members`, `softDeleteChannel`
 * really stamps the channel, and the roster / count reads project off the same
 * arrays. That is what lets a single test assert "after the sweep, this row is
 * gone from BOTH reads" instead of "the delete was called".
 */
function makeWorld() {
  const channels: ChannelRow[] = [
    channelRow(ROOM),
    channelRow(DM, { is_direct: true, direct_key: [LEAVER, SURVIVOR].sort().join(":") }),
    channelRow(CLOSED_DM, {
      is_direct: true,
      direct_key: "closed:pair",
      deleted_at: "2026-08-01T00:00:00Z",
    }),
    channelRow(PUBLIC_ELSEWHERE, { visibility: "public" }),
  ];
  const members: ChannelMemberRow[] = [
    memberRow(ROOM, LEAVER),
    memberRow(ROOM, SURVIVOR),
    memberRow(DM, LEAVER),
    memberRow(DM, SURVIVOR),
    memberRow(CLOSED_DM, LEAVER),
    memberRow(CLOSED_DM, SURVIVOR),
    // The leaver is NOT in the public channel — it still comes back from
    // `listChannels` (which ORs in every public room), so the sweep has to
    // intersect rather than trust the read.
    memberRow(PUBLIC_ELSEWHERE, SURVIVOR),
  ];
  const order: string[] = [];

  vi.mocked(repo.listMyMemberships).mockImplementation(async (wsId, userId) =>
    members.filter((m) => m.workspace_id === wsId && m.user_id === userId)
  );
  vi.mocked(repo.listChannels).mockImplementation(async (wsId, opts) =>
    channels.filter(
      (c) =>
        c.workspace_id === wsId &&
        c.deleted_at === null &&
        (c.visibility === "public" || opts.memberChannelIds.includes(c.id))
    )
  );
  vi.mocked(repo.softDeleteChannel).mockImplementation(async (wsId, id) => {
    order.push(`close:${id}`);
    const c = channels.find((x) => x.id === id && x.workspace_id === wsId);
    if (c) c.deleted_at = "2026-08-10T12:00:00Z";
  });
  vi.mocked(repo.deleteMember).mockImplementation(async (channelId, userId) => {
    order.push(`delete:${channelId}`);
    const i = members.findIndex(
      (m) => m.channel_id === channelId && m.user_id === userId
    );
    if (i >= 0) members.splice(i, 1);
  });
  vi.mocked(repo.listMembers).mockImplementation(async (channelId) =>
    members.filter((m) => m.channel_id === channelId)
  );
  vi.mocked(repo.memberCounts).mockImplementation(async (ids) => {
    const out = new Map<string, number>();
    for (const id of ids) {
      out.set(id, members.filter((m) => m.channel_id === id).length);
    }
    return out;
  });

  return { channels, members, order };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("removeWorkspaceDepartedMember — the row is gone, not filtered", () => {
  it("drops the departed member from EVERY channel they belonged to", async () => {
    const world = makeWorld();

    const result = await removeWorkspaceDepartedMember(WS, LEAVER);

    expect(result.membershipsRemoved).toBe(3);
    expect(world.members.some((m) => m.user_id === LEAVER)).toBe(false);
    expect(world.members.map((m) => m.channel_id).sort()).toEqual(
      [DM, CLOSED_DM, PUBLIC_ELSEWHERE, ROOM].sort()
    );
  });

  it("leaves the roster read and the member COUNT clean afterwards — no filter needed", async () => {
    await removeWorkspaceDepartedMember(WS, makeWorld() && LEAVER);

    // listChannelMembers reads `repo.listMembers`; the DTO layer adds profiles
    // and presence and nothing else, so the roster is exactly these rows.
    const roster = await repo.listMembers(ROOM);
    expect(roster.map((m) => m.user_id)).toEqual([SURVIVOR]);

    // And the count `classify`'s implicit trigger keys on. Before the sweep the
    // room read as 2; the ghost would have kept it there while only one person
    // could actually answer.
    const counts = await repo.memberCounts([ROOM, DM]);
    expect(counts.get(ROOM)).toBe(1);
    expect(counts.get(DM)).toBe(1);
  });

  it("never touches a channel the departed member was not in", async () => {
    const world = makeWorld();
    await removeWorkspaceDepartedMember(WS, LEAVER);
    expect(
      world.members.filter((m) => m.channel_id === PUBLIC_ELSEWHERE)
    ).toHaveLength(1);
    expect(vi.mocked(repo.deleteMember).mock.calls.map((c) => c[0])).not.toContain(
      PUBLIC_ELSEWHERE
    );
  });

  it("is a no-op for a user with no channel memberships", async () => {
    makeWorld();
    const result = await removeWorkspaceDepartedMember(WS, "nobody-at-all");
    expect(result).toEqual({ membershipsRemoved: 0, directChannelsClosed: 0 });
    expect(repo.listChannels).not.toHaveBeenCalled();
    expect(repo.deleteMember).not.toHaveBeenCalled();
    expect(repo.softDeleteChannel).not.toHaveBeenCalled();
  });
});

describe("removeWorkspaceDepartedMember — the DM branch", () => {
  it("CLOSES the live 1:1 as well as emptying it, so the survivor is never left with a one-member DM", async () => {
    const world = makeWorld();

    const result = await removeWorkspaceDepartedMember(WS, LEAVER);

    expect(result.directChannelsClosed).toBe(1);
    expect(world.channels.find((c) => c.id === DM)?.deleted_at).not.toBeNull();
    expect(vi.mocked(repo.softDeleteChannel).mock.calls.map((c) => c[1])).toEqual([
      DM,
    ]);
  });

  it("does NOT close a group channel — one fewer member is the right outcome there", async () => {
    const world = makeWorld();
    await removeWorkspaceDepartedMember(WS, LEAVER);
    expect(world.channels.find((c) => c.id === ROOM)?.deleted_at).toBeNull();
  });

  it("does not re-stamp a DM that was already closed", async () => {
    const world = makeWorld();
    await removeWorkspaceDepartedMember(WS, LEAVER);
    // The original close time survives — a departure must not rewrite when the
    // conversation was closed, and the row is already hidden either way.
    expect(world.channels.find((c) => c.id === CLOSED_DM)?.deleted_at).toBe(
      "2026-08-01T00:00:00Z"
    );
    // …but the membership row still goes.
    expect(
      world.members.some((m) => m.channel_id === CLOSED_DM && m.user_id === LEAVER)
    ).toBe(false);
  });

  it("closes BEFORE it deletes — the crash-safe order", async () => {
    const world = makeWorld();
    await removeWorkspaceDepartedMember(WS, LEAVER);
    expect(world.order.indexOf(`close:${DM}`)).toBeLessThan(
      world.order.indexOf(`delete:${DM}`)
    );
  });
});
