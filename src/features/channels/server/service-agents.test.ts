/**
 * THE ONE READ THE ROLLBACK DELIBERATELY KEPT, and it had no server-side test at all.
 *
 * `GET /api/channels/[channelId]/agents` → `service-reads.listAgents` →
 * `repository-agents.listAgentsByChannel` → `agents-dto.mapAgentRow` is the last surviving
 * piece of the named-agent surface (channels rollback §1, F-141). Every other agent route,
 * service and repository function was deleted, and `repository-agents.test.ts` /
 * `service-agents.test.ts` were deleted WHOLESALE along with them — including the cases that
 * covered the part that stayed. This file is that coverage, rebuilt for the read that is left
 * (F-146).
 *
 * IT IS NOT A DEAD READ. It renders HISTORICAL ATTRIBUTION: a stored message carries
 * `metadata.author_agent_id`, and the transcript resolves that id to the handle it was written
 * under. The messages outlive the feature, so this read outlives it too — which means its
 * three properties are still worth pinning, and two of them are easy to "clean up" by mistake:
 *
 *   1. DISMISSED ROWS ARE INCLUDED. The agents most likely to own old messages are precisely
 *      the retired ones, so a status filter here would blank the attribution on exactly the
 *      history that needs it most.
 *   2. THE VISIBILITY GATE IS THE CHANNEL'S. The service goes through `loadVisibleChannel`,
 *      so a private channel the caller is not in reads as NOT FOUND rather than as an empty
 *      roster — an empty list would confirm the channel exists.
 *   3. THE MAPPER NARROWS. The row carries `workspace_id`, `status`, `engaged_at` and
 *      `engaged_by`; the DTO is three fields. `engaged_*` are historical values that nothing
 *      writes any more, and leaking them would put a dead engagement's timestamps on the wire
 *      where a reader could mistake them for live state.
 *
 * Repository mocked, `service-shared` real (the visibility gate runs), Supabase mocked with the
 * chainable-builder stub the sibling repository suites use.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./repository");
vi.mock("./repository-agents");
vi.mock("./repository-collab");

import * as repo from "./repository";
import * as repoAgents from "./repository-agents";
import { listAgents } from "./service-reads";
import { mapAgentRow, type ChannelAgentRow } from "./agents-dto";
import { ChannelNotFoundError } from "./errors";
import type { ChannelContext } from "./service-shared";
import type { ChannelMemberRow, ChannelRow } from "./dto";

const WS = "ws-1";
const USER = "user-1";
const OTHER = "user-2";
const CHANNEL_ID = "chan-1";

const ctx: ChannelContext = {
  workspaceId: WS,
  userId: USER,
  source: "user",
  role: "member",
};

function channelRow(over: Partial<ChannelRow> = {}): ChannelRow {
  return {
    id: CHANNEL_ID,
    workspace_id: WS,
    created_by: USER,
    slug: "general",
    name: "General",
    topic: "",
    visibility: "private",
    is_direct: false,
    direct_key: null,
    archived_at: null,
    deleted_at: null,
    created_at: "2026-07-20T00:00:00Z",
    updated_at: "2026-07-20T00:00:00Z",
    ...over,
  };
}

function memberRow(userId: string): ChannelMemberRow {
  return {
    channel_id: CHANNEL_ID,
    user_id: userId,
    workspace_id: WS,
    role: userId === USER ? "owner" : "member",
    last_read_at: null,
    notify_scope: "all",
    agent_tool_profile: "full",
    added_by: USER,
    joined_at: "2026-07-20T00:00:00Z",
  };
}

function agentRow(over: Partial<ChannelAgentRow> = {}): ChannelAgentRow {
  return {
    id: "agent-1",
    channel_id: CHANNEL_ID,
    workspace_id: WS,
    owner_user_id: USER,
    name: "quartz",
    status: "active",
    engaged_at: null,
    engaged_by: null,
    created_at: "2026-07-31T00:00:00Z",
    updated_at: "2026-07-31T00:00:00Z",
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(repo.findChannelBySlug).mockResolvedValue(channelRow());
  vi.mocked(repo.findMembership).mockResolvedValue(memberRow(USER));
});

describe("listAgents — the attribution roster", () => {
  it("returns every agent the channel ever had, mapped to the attribution shape", async () => {
    vi.mocked(repoAgents.listAgentsByChannel).mockResolvedValue([
      agentRow({ id: "a-1", name: "quartz", owner_user_id: USER }),
      agentRow({ id: "a-2", name: "flint", owner_user_id: OTHER }),
    ]);

    const agents = await listAgents(ctx, "general");

    expect(agents).toEqual([
      { id: "a-1", ownerUserId: USER, name: "quartz" },
      { id: "a-2", ownerUserId: OTHER, name: "flint" },
    ]);
  });

  it("INCLUDES DISMISSED AND PARKED ROWS — a retired agent still wrote the messages it wrote", async () => {
    // The one property a future "tidy up the dead statuses" change would break. A transcript
    // that cannot name a dismissed agent renders its old messages as unattributed, and the
    // dismissed rows are the ones with the most history behind them.
    vi.mocked(repoAgents.listAgentsByChannel).mockResolvedValue([
      agentRow({ id: "a-1", name: "quartz", status: "dismissed" }),
      agentRow({ id: "a-2", name: "flint", status: "parked" }),
      agentRow({ id: "a-3", name: "onyx", status: "summoned" }),
    ]);

    const agents = await listAgents(ctx, "general");

    expect(agents.map((a) => a.name)).toEqual(["quartz", "flint", "onyx"]);
    // ...and the service applies no filter of its own: the repository's list is the answer.
    expect(vi.mocked(repoAgents.listAgentsByChannel)).toHaveBeenCalledTimes(1);
  });

  it("passes the RESOLVED channel id, never the caller's ref", async () => {
    // The ref may be a slug. Handing the repository a slug would read no rows and look like
    // "this channel has no agents" rather than like a bug.
    vi.mocked(repoAgents.listAgentsByChannel).mockResolvedValue([]);

    await listAgents(ctx, "general");

    expect(vi.mocked(repoAgents.listAgentsByChannel)).toHaveBeenCalledWith(CHANNEL_ID);
  });

  it("an empty channel is an empty list, not an error", async () => {
    vi.mocked(repoAgents.listAgentsByChannel).mockResolvedValue([]);
    await expect(listAgents(ctx, "general")).resolves.toEqual([]);
  });
});

describe("listAgents — the visibility gate is the CHANNEL's", () => {
  it("a private channel the caller is not in reads as NOT FOUND, and reads no rows", async () => {
    // NOT-FOUND rather than an empty roster, and the difference is the point: an empty list
    // would confirm the channel exists to somebody who may not know that.
    vi.mocked(repo.findMembership).mockResolvedValue(null);

    await expect(listAgents(ctx, "general")).rejects.toBeInstanceOf(ChannelNotFoundError);
    // The refusal happens BEFORE the read — no roster is fetched for a channel the caller
    // cannot see.
    expect(vi.mocked(repoAgents.listAgentsByChannel)).not.toHaveBeenCalled();
  });

  it("a PUBLIC channel is readable by a non-member (same rule as the transcript)", async () => {
    vi.mocked(repo.findChannelBySlug).mockResolvedValue(
      channelRow({ visibility: "public" })
    );
    vi.mocked(repo.findMembership).mockResolvedValue(null);
    vi.mocked(repoAgents.listAgentsByChannel).mockResolvedValue([agentRow()]);

    await expect(listAgents(ctx, "general")).resolves.toHaveLength(1);
  });

  it("a channel that does not exist is NOT FOUND", async () => {
    vi.mocked(repo.findChannelBySlug).mockResolvedValue(null);

    await expect(listAgents(ctx, "nope")).rejects.toBeInstanceOf(ChannelNotFoundError);
    expect(vi.mocked(repoAgents.listAgentsByChannel)).not.toHaveBeenCalled();
  });
});

describe("mapAgentRow — the DTO narrows, and that is a privacy property", () => {
  it("hands back exactly three fields", () => {
    expect(Object.keys(mapAgentRow(agentRow())).sort()).toEqual([
      "id",
      "name",
      "ownerUserId",
    ]);
  });

  it("drops the HISTORICAL engagement columns rather than reporting dead state", () => {
    // `engaged_at` / `engaged_by` still hold whatever they held when engagement was deleted
    // (no destructive migration ran — the rows were left in place). Putting them on the wire
    // would let a reader mistake a frozen timestamp for a live engagement.
    const mapped = mapAgentRow(
      agentRow({
        engaged_at: "2026-07-31T12:00:00Z",
        engaged_by: OTHER,
        status: "active",
      })
    ) as Record<string, unknown>;

    expect(mapped.engagedAt).toBeUndefined();
    expect(mapped.engaged_at).toBeUndefined();
    expect(mapped.engagedBy).toBeUndefined();
    expect(mapped.engaged_by).toBeUndefined();
  });

  it("drops `status` and `workspace_id` too — attribution needs neither", () => {
    const mapped = mapAgentRow(agentRow({ status: "dismissed" })) as Record<
      string,
      unknown
    >;
    expect(mapped.status).toBeUndefined();
    expect(mapped.workspaceId).toBeUndefined();
    expect(mapped.workspace_id).toBeUndefined();
    expect(mapped.channelId).toBeUndefined();
  });
});
