/**
 * `removeMember` — THE WIRING.
 *
 * ⚠ The channels sweep is deliberately NOT mocked: mocking
 * `removeWorkspaceDepartedMember` would only assert this file calls a name,
 * while the failure to catch is a sweep that RUNS AND DOES NOTHING. So the real
 * service runs against a mocked `channels/server/repository` and the assertion
 * is on the DELETE reaching the database.
 *
 * Also pinned: the sweep runs AFTER the `workspace_members` delete, and a sweep
 * that throws must not strand the removal itself.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/shared/supabase/admin", () => ({ supabaseAdmin: vi.fn() }));
vi.mock("./authz", () => ({ requireWorkspaceRole: vi.fn() }));
vi.mock("./repository", () => ({ findMembership: vi.fn() }));
vi.mock("@/features/billing/server/seats", () => ({ syncSeatQuantity: vi.fn() }));
vi.mock("@/features/channels/server/repository");

import { supabaseAdmin } from "@/shared/supabase/admin";
import { requireWorkspaceRole } from "./authz";
import { findMembership } from "./repository";
import { syncSeatQuantity } from "@/features/billing/server/seats";
import * as channelsRepo from "@/features/channels/server/repository";
import { removeMember } from "./membership-admin";
import type { ChannelMemberRow, ChannelRow } from "@/features/channels/server/dto";

const WS = "11111111-e29b-41d4-a716-446655440000";
const ADMIN = "22222222-e29b-41d4-a716-446655440000";
const LEAVER = "33333333-e29b-41d4-a716-446655440000";
const ROOM = "chan-room";
const DM = "chan-dm";

/** Every write the handler made, in order, across BOTH lanes. */
let trace: string[];

/** Chainable thenable Supabase-builder stub (repository-messages.test idiom). */
function primeSupabase() {
  const builder: Record<string, unknown> = {};
  let table = "";
  let op = "";
  const rec = () => builder;
  Object.assign(builder, {
    from: (t: string) => {
      table = t;
      return builder;
    },
    delete: () => {
      op = "delete";
      return builder;
    },
    update: () => {
      op = "update";
      return builder;
    },
    // Both writes record a `workspace_activity_events` row. It is awaited, so
    // the mock has to answer it; `recordActivity` swallows failures, so an
    // absent stub would only show up as stderr noise.
    insert: () => {
      op = "insert";
      return builder;
    },
    select: () => {
      op = "select";
      return builder;
    },
    eq: rec,
    then: (resolve: (r: unknown) => void) => {
      trace.push(`db:${op}:${table}`);
      resolve({ data: null, error: null, count: 2 });
    },
  });
  vi.mocked(supabaseAdmin).mockReturnValue(builder as never);
}

function channelRow(id: string, over: Partial<ChannelRow> = {}): ChannelRow {
  return {
    id,
    workspace_id: WS,
    created_by: ADMIN,
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

function memberRow(channelId: string): ChannelMemberRow {
  return {
    channel_id: channelId,
    user_id: LEAVER,
    workspace_id: WS,
    role: "member",
    last_read_at: null,
    agent_tool_profile: "full",
    added_by: ADMIN,
    joined_at: "2026-08-10T00:00:00Z",
  } as ChannelMemberRow;
}

beforeEach(() => {
  vi.clearAllMocks();
  trace = [];
  primeSupabase();
  vi.mocked(requireWorkspaceRole).mockResolvedValue("owner");
  vi.mocked(findMembership).mockResolvedValue({
    userId: LEAVER,
    role: "member",
    status: "active",
  } as never);
  vi.mocked(syncSeatQuantity).mockResolvedValue(undefined as never);
  vi.mocked(channelsRepo.listMyMemberships).mockResolvedValue([
    memberRow(ROOM),
    memberRow(DM),
  ]);
  vi.mocked(channelsRepo.listChannels).mockResolvedValue([
    channelRow(ROOM),
    channelRow(DM, { is_direct: true, direct_key: `${ADMIN}:${LEAVER}` }),
  ]);
  vi.mocked(channelsRepo.softDeleteChannel).mockImplementation(async (_ws, id) => {
    trace.push(`channels:close:${id}`);
  });
  vi.mocked(channelsRepo.deleteMember).mockImplementation(async (id) => {
    trace.push(`channels:delete:${id}`);
  });
});

describe("removeMember — the departure reaches into channels", () => {
  it("deletes the departed member's channel_members row in every room", async () => {
    await removeMember(WS, ADMIN, LEAVER);
    expect(vi.mocked(channelsRepo.deleteMember).mock.calls).toEqual([
      [ROOM, LEAVER],
      [DM, LEAVER],
    ]);
  });

  it("closes the departed member's live DM", async () => {
    await removeMember(WS, ADMIN, LEAVER);
    expect(vi.mocked(channelsRepo.softDeleteChannel).mock.calls).toEqual([[WS, DM]]);
  });

  it("sweeps AFTER the workspace_members delete, never before", async () => {
    await removeMember(WS, ADMIN, LEAVER);
    expect(trace[0]).toBe("db:delete:workspace_members");
    expect(trace.slice(1)).toEqual([
      `channels:delete:${ROOM}`,
      `channels:close:${DM}`,
      `channels:delete:${DM}`,
      // The activity row is recorded LAST, deliberately outside the
      // delete → sweep sequence this test pins.
      "db:insert:workspace_activity_events",
    ]);
  });

  it("does not sweep when there was nothing to remove (idempotent no-op)", async () => {
    vi.mocked(findMembership).mockResolvedValue(null as never);
    await removeMember(WS, ADMIN, LEAVER);
    expect(channelsRepo.listMyMemberships).not.toHaveBeenCalled();
    expect(channelsRepo.deleteMember).not.toHaveBeenCalled();
  });

  it("a failing sweep is logged, not thrown — the workspace removal stands", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(channelsRepo.deleteMember).mockRejectedValue(new Error("boom"));

    await expect(removeMember(WS, ADMIN, LEAVER)).resolves.toBeUndefined();

    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining("channel sweep failed"),
      "boom"
    );
    // …and the follow-on best-effort work still runs.
    expect(syncSeatQuantity).toHaveBeenCalledWith(WS);
    spy.mockRestore();
  });
});
