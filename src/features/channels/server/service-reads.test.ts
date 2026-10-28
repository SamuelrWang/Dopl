/**
 * Unit tests for the channels read service. Repository mocked; service-shared
 * runs for real.
 *
 * Covers:
 *   - `listChannelMembers` notify-scope privacy — `notify_scope` is a private
 *     per-member preference, exposed ONLY on the caller's OWN row so no one can
 *     see who muted the channel;
 *   - the read-watermark loop guard (content-derived + monotonic);
 *   - the THREAD SCOPE on `readMessages` — the `metadata.threadId` filter that
 *     isolates one exchange, its legacy-id tolerance, and the two things it must
 *     NOT do: move the watermark, or soften the read-visibility gate.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./repository");
vi.mock("./repository-messages");
vi.mock("./repository-collab");
vi.mock("./repository-threads");
vi.mock("@/features/workspaces/server/repository");

import * as repo from "./repository";
import * as repoMessages from "./repository-messages";
import * as collab from "./repository-collab";
import * as repoThreads from "./repository-threads";
import * as workspaceRepo from "@/features/workspaces/server/repository";
import {
  getChannelThread,
  listChannelMembers,
  listChannelThreads,
  readMessages,
} from "./service-reads";
import { ChannelNotFoundError, ThreadNotFoundError } from "./errors";
import type { ChannelContext } from "./service-shared";
import type {
  ChannelMemberRow,
  ChannelMessageRow,
  ChannelRow,
  ChannelThreadActivityRow,
  ChannelThreadRow,
} from "./dto";

const WS = "ws-1";
const USER = "user-1";
const OTHER = "user-2";
/** A first-class thread id (`metadata.threadId`), as the read scope receives it. */
const THREAD_THREAD_ID = "660e8400-e29b-41d4-a716-446655440111";

const ctx: ChannelContext = {
  workspaceId: WS,
  userId: USER,
  credentialSubjectUserId: USER,
  source: "user",
  role: "member",
};

function channelRow(): ChannelRow {
  return {
    id: "chan-1",
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
  };
}

function memberRow(userId: string, notifyScope: string): ChannelMemberRow {
  return {
    channel_id: "chan-1",
    user_id: userId,
    workspace_id: WS,
    role: userId === USER ? "owner" : "member",
    last_read_at: null,
    notify_scope: notifyScope,
    agent_tool_profile: "full",
    favorited_at: null,
    added_by: USER,
    joined_at: "2026-07-20T00:00:00Z",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(repo.findChannelBySlug).mockResolvedValue(channelRow());
  // loadVisibleChannel gate: caller is a member of the private channel.
  vi.mocked(repo.findMembership).mockResolvedValue(memberRow(USER, "none"));
  vi.mocked(repo.fetchProfiles).mockResolvedValue([]);
  // Presence hydration: no one online by default.
  vi.mocked(collab.presenceForWorkspace).mockResolvedValue(new Map());
  // Workspace-role hydration for the roster's Guest pill: none by default.
  vi.mocked(workspaceRepo.listMemberRolesByUserIds).mockResolvedValue(new Map());
});

describe("listChannelMembers — notify_scope privacy", () => {
  it("exposes the caller's own notifyScope, nulls every other member's", async () => {
    vi.mocked(repo.listMembers).mockResolvedValue([
      memberRow(USER, "none"), // caller — muted; must stay visible to self
      memberRow(OTHER, "all"), // teammate — scope must be hidden
    ]);

    const members = await listChannelMembers(ctx, "general");

    const mine = members.find((m) => m.userId === USER);
    const theirs = members.find((m) => m.userId === OTHER);
    expect(mine?.notifyScope).toBe("none");
    expect(theirs?.notifyScope).toBeNull();
    // agent_tool_profile is private the same way: self only.
    expect(mine?.agentToolProfile).toBe("full");
    expect(theirs?.agentToolProfile).toBeNull();
    // Other roster fields for the teammate are still present.
    expect(theirs?.role).toBe("member");
  });

  it("surfaces each member's WORKSPACE role for the Guest pill (channel role is only owner/member)", async () => {
    vi.mocked(repo.listMembers).mockResolvedValue([
      memberRow(USER, "all"), // channel role owner
      memberRow(OTHER, "all"), // channel role member — but a workspace GUEST
    ]);
    vi.mocked(workspaceRepo.listMemberRolesByUserIds).mockResolvedValue(
      new Map([
        [USER, "owner"],
        [OTHER, "guest"],
      ])
    );

    const members = await listChannelMembers(ctx, "general");

    expect(members.find((m) => m.userId === OTHER)?.workspaceRole).toBe("guest");
    expect(members.find((m) => m.userId === USER)?.workspaceRole).toBe("owner");
    // Bounded to exactly the roster's ids (§9), never the whole workspace.
    expect(workspaceRepo.listMemberRolesByUserIds).toHaveBeenCalledWith(WS, [
      USER,
      OTHER,
    ]);
  });

  it("maps a member with no workspace-role row to null — not a guest", async () => {
    vi.mocked(repo.listMembers).mockResolvedValue([memberRow(OTHER, "all")]);
    // Default mock returns an empty map — the field must be null, never undefined.
    const members = await listChannelMembers(ctx, "general");
    expect(members[0].workspaceRole).toBeNull();
  });

  it("exposes presence (agentOnline / lastSeenAt) for every member", async () => {
    vi.mocked(repo.listMembers).mockResolvedValue([
      memberRow(USER, "all"),
      memberRow(OTHER, "all"),
    ]);
    vi.mocked(collab.presenceForWorkspace).mockResolvedValue(
      new Map([[OTHER, { online: true, lastSeenAt: "2026-07-26T00:00:00Z" }]])
    );

    const members = await listChannelMembers(ctx, "general");
    const mine = members.find((m) => m.userId === USER);
    const theirs = members.find((m) => m.userId === OTHER);
    // Presence is NOT private — a teammate's online agent must be visible.
    expect(theirs?.agentOnline).toBe(true);
    expect(theirs?.lastSeenAt).toBe("2026-07-26T00:00:00Z");
    expect(mine?.agentOnline).toBe(false);
  });
});

describe("readMessages — read-watermark loop guard (2026-07-27 CPU incident)", () => {
  // The watermark must be content-derived and monotonic: a refetch that
  // shows nothing new must NOT write (a write is a realtime event that
  // re-fires every subscribed tab — the self-sustaining refetch loop).
  function messageRow(seq: number, createdAt: string): ChannelMessageRow {
    return {
      id: `msg-${seq}`,
      seq,
      channel_id: "chan-1",
      workspace_id: WS,
      author_user_id: OTHER,
      author_kind: "user",
      kind: "message",
      body: "hi",
      metadata: {},
      client_msg_id: null,
      created_at: createdAt,
    };
  }

  it("skips the watermark write when the thread is empty", async () => {
    vi.mocked(repoMessages.listMessages).mockResolvedValue([]);
    await readMessages(ctx, "general", { limit: 50 });
    expect(repo.updateLastRead).not.toHaveBeenCalled();
  });

  it("skips the watermark write when nothing is newer than the current watermark", async () => {
    vi.mocked(repo.findMembership).mockResolvedValue({
      ...memberRow(USER, "all"),
      last_read_at: "2026-07-27T12:00:00.000Z",
    });
    vi.mocked(repoMessages.listMessages).mockResolvedValue([
      messageRow(1, "2026-07-27T11:00:00.000Z"),
      messageRow(2, "2026-07-27T12:00:00.000Z"),
    ]);
    await readMessages(ctx, "general", { limit: 50 });
    expect(repo.updateLastRead).not.toHaveBeenCalled();
  });

  it("advances the watermark to the newest message shown (not now())", async () => {
    vi.mocked(repo.findMembership).mockResolvedValue({
      ...memberRow(USER, "all"),
      last_read_at: "2026-07-27T12:00:00.000Z",
    });
    vi.mocked(repoMessages.listMessages).mockResolvedValue([
      messageRow(3, "2026-07-27T12:30:00.000Z"),
      messageRow(4, "2026-07-27T13:00:00.000Z"),
    ]);
    await readMessages(ctx, "general", { limit: 50 });
    expect(repo.updateLastRead).toHaveBeenCalledTimes(1);
    expect(repo.updateLastRead).toHaveBeenCalledWith(
      "chan-1",
      USER,
      "2026-07-27T13:00:00.000Z"
    );
  });

  it("writes on first read (null watermark) with the newest message time", async () => {
    vi.mocked(repoMessages.listMessages).mockResolvedValue([
      messageRow(1, "2026-07-27T10:00:00.000Z"),
    ]);
    await readMessages(ctx, "general", { limit: 50 });
    expect(repo.updateLastRead).toHaveBeenCalledWith(
      "chan-1",
      USER,
      "2026-07-27T10:00:00.000Z"
    );
  });

  it("🔒 DOES NOT WAIT FOR THE WATERMARK WRITE", async () => {
    // **OPTION H, 2026-10-10: the bump is off the response path.** It is a
    // `channel_members` UPDATE round trip and nothing in the answer derives from
    // it, so it must neither DELAY the read nor be able to fail it.
    //
    // ⚠ **A WRITE THAT NEVER SETTLES, AND THAT IS THE ONLY MOCK THAT PINS THIS
    // (2026-10-11).** A REJECTING write proves only that the failure does not
    // propagate — which the pre-change `await` inside a try/catch satisfied too,
    // so that assertion passed over the old code and locked nothing. Worse, in
    // vitest `after()` throws (no request scope) and `detach` runs the work
    // INLINE, so an `await` here would hang the response: a promise that never
    // resolves is what tells the two apart. If this test ever times out, the
    // bump is back on the critical path.
    vi.mocked(repo.updateLastRead).mockReturnValue(new Promise<void>(() => {}));
    vi.mocked(repoMessages.listMessages).mockResolvedValue([
      messageRow(1, "2026-07-27T10:00:00.000Z"),
    ]);

    const messages = await readMessages(ctx, "general", { limit: 50 });

    expect(messages).toHaveLength(1);
    expect(repo.updateLastRead).toHaveBeenCalledTimes(1);
  });

  it("🔒 ANSWERS THE READ WHEN THE WATERMARK WRITE FAILS", async () => {
    // The other half: a rejection has nowhere to surface. Weaker than the case
    // above (see its note) and kept because `detach` swallowing the rejection is
    // what keeps it off the request AND out of the process as an unhandled one.
    vi.mocked(repo.updateLastRead).mockRejectedValue(new Error("write failed"));
    vi.mocked(repoMessages.listMessages).mockResolvedValue([
      messageRow(1, "2026-07-27T10:00:00.000Z"),
    ]);

    const messages = await readMessages(ctx, "general", { limit: 50 });

    expect(messages).toHaveLength(1);
    expect(repo.updateLastRead).toHaveBeenCalledTimes(1);
  });

  // A thread-scoped read shows a SUBSET, so its newest row can be newer than
  // unrelated messages the member has never seen. The watermark is monotonic,
  // so advancing it here would mark those read. Reading one exchange is not
  // viewing the channel.
  it("moves NO watermark when the read is scoped to one thread", async () => {
    vi.mocked(repoMessages.listMessages).mockResolvedValue([
      messageRow(9, "2026-07-27T18:00:00.000Z"),
    ]);
    await readMessages(ctx, "general", { limit: 50, thread: THREAD_THREAD_ID });
    expect(repo.updateLastRead).not.toHaveBeenCalled();
  });
});

describe("readMessages — thread scope", () => {
  function threadRow(seq: number, threadId: string): ChannelMessageRow {
    return {
      id: `msg-${seq}`,
      seq,
      channel_id: "chan-1",
      workspace_id: WS,
      author_user_id: OTHER,
      author_kind: "user",
      kind: "message",
      body: "hi",
      metadata: { threadId },
      client_msg_id: null,
      created_at: "2026-07-31T00:00:00Z",
    };
  }

  it("passes the thread id down to the repository as threadId", async () => {
    vi.mocked(repoMessages.listMessages).mockResolvedValue([
      threadRow(4, THREAD_THREAD_ID),
    ]);

    const messages = await readMessages(ctx, "general", {
      limit: 50,
      thread: THREAD_THREAD_ID,
    });

    expect(repoMessages.listMessages).toHaveBeenCalledWith("chan-1", {
      since: undefined,
      limit: 50,
      threadId: THREAD_THREAD_ID,
    });
    expect(messages.map((m) => m.seq)).toEqual([4]);
  });

  it("accepts a legacy thread-<channelId>-<seq> id unchanged", async () => {
    const legacy = "thread-chan-1-42";
    vi.mocked(repoMessages.listMessages).mockResolvedValue([threadRow(6, legacy)]);

    await readMessages(ctx, "general", { limit: 50, thread: legacy });

    expect(
      vi.mocked(repoMessages.listMessages).mock.calls[0][1].threadId
    ).toBe(legacy);
  });

  it("returns [] when the thread id matches nothing (a filter, not a lookup)", async () => {
    vi.mocked(repoMessages.listMessages).mockResolvedValue([]);

    await expect(
      readMessages(ctx, "general", { limit: 50, thread: "thread-nothing-0" })
    ).resolves.toEqual([]);
  });

  it("leaves the unfiltered read untouched (threadId undefined)", async () => {
    vi.mocked(repoMessages.listMessages).mockResolvedValue([]);

    await readMessages(ctx, "general", { since: 3, limit: 50 });

    expect(repoMessages.listMessages).toHaveBeenCalledWith("chan-1", {
      since: 3,
      limit: 50,
      threadId: undefined,
    });
  });

  it("still enforces the read-visibility gate (non-member, private channel)", async () => {
    // The scope is a filter on top of the gate, never a way around it.
    vi.mocked(repo.findMembership).mockResolvedValue(null);

    await expect(
      readMessages(ctx, "general", { limit: 50, thread: THREAD_THREAD_ID })
    ).rejects.toBeInstanceOf(ChannelNotFoundError);
    expect(repoMessages.listMessages).not.toHaveBeenCalled();
  });
});

describe("listChannelThreads / getChannelThread — reads", () => {
  const THREAD_ID = "660e8400-e29b-41d4-a716-446655440111";

  function threadRow(overrides: Partial<ChannelThreadActivityRow> = {}): ChannelThreadActivityRow {
    return {
      id: THREAD_ID,
      channel_id: "chan-1",
      workspace_id: WS,
      title: "Ship it",
      status: "open",
      outcome: null,
      mode: "interactive",
      created_by: USER,
      target_user_id: OTHER,
      created_at: "2026-07-27T00:00:00Z",
      updated_at: "2026-07-27T00:00:00Z",
      closed_at: null,
      outcome_summary: null,
      last_activity_at: "2026-07-27T00:00:00Z",
      ...overrides,
    };
  }

  /** The row shape a SINGLE-thread read returns — `channel_threads` has no
   *  activity column, so the derived one is simply not there. */
  function withoutActivity(row: ChannelThreadActivityRow): ChannelThreadRow {
    const copy: Record<string, unknown> = { ...row };
    delete copy.last_activity_at;
    return copy as unknown as ChannelThreadRow;
  }

  it("lists the channel's threads (visibility-gated) as DTOs", async () => {
    vi.mocked(repoThreads.listThreadsByChannel).mockResolvedValue({
      rows: [
        threadRow({ id: THREAD_ID, title: "A" }),
        threadRow({
          id: "other",
          title: "B",
          status: "closed",
          outcome: "completed",
        }),
      ],
      truncated: false,
    });

    const { threads, truncated } = await listChannelThreads(ctx, "general");

    expect(repoThreads.listThreadsByChannel).toHaveBeenCalledWith("chan-1");
    // ⚠ The REPOSITORY's order rides through untouched — the service does not
    // re-sort, because the repository's LIMIT clipped against that order.
    expect(threads.map((t) => t.title)).toEqual(["A", "B"]);
    expect(threads[1].outcome).toBe("completed");
    expect(truncated).toBe(false);
  });

  it("carries the derived activity clock onto the DTO", async () => {
    vi.mocked(repoThreads.listThreadsByChannel).mockResolvedValue({
      rows: [threadRow({ last_activity_at: "2026-08-18T09:00:00Z" })],
      truncated: false,
    });

    const { threads } = await listChannelThreads(ctx, "general");

    // The sidebar's 24h window is arithmetic over THIS field, so losing it in
    // the mapper renders every thread inactive rather than failing.
    expect(threads[0].lastActivityAt).toBe("2026-08-18T09:00:00Z");
  });

  it("passes the CLIP through instead of swallowing it", async () => {
    // A bounded read at its ceiling is indistinguishable from an exhausted one
    // (INVARIANTS §9) — the flag is the only thing that tells them apart, and a
    // service that drops it presents a partial list as the whole one.
    vi.mocked(repoThreads.listThreadsByChannel).mockResolvedValue({
      rows: [threadRow()],
      truncated: true,
    });

    const { truncated } = await listChannelThreads(ctx, "general");

    expect(truncated).toBe(true);
  });

  it("does NOT claim an activity clock on a single-thread read", async () => {
    // `get_thread` loads one row off `channel_threads`, which has no such column.
    // ⚠ Absent means "this view did not derive it", never "no activity" — a
    // fallback to `createdAt` here would sort a live thread as cold.
    vi.mocked(repoThreads.findThreadByChannelAndId).mockResolvedValue(
      withoutActivity(threadRow())
    );

    const thread = await getChannelThread(ctx, "general", THREAD_ID);

    expect(thread.lastActivityAt).toBeUndefined();
  });

  it("returns one thread by id, scoped to the channel", async () => {
    vi.mocked(repoThreads.findThreadByChannelAndId).mockResolvedValue(
      threadRow({ outcome_summary: "done" })
    );

    const thread = await getChannelThread(ctx, "general", THREAD_ID);

    expect(repoThreads.findThreadByChannelAndId).toHaveBeenCalledWith("chan-1", THREAD_ID);
    expect(thread.id).toBe(THREAD_ID);
    expect(thread.outcomeSummary).toBe("done");
  });

  it("404s a thread id that is not in this channel (id can't be probed)", async () => {
    vi.mocked(repoThreads.findThreadByChannelAndId).mockResolvedValue(null);
    await expect(
      getChannelThread(ctx, "general", THREAD_ID)
    ).rejects.toBeInstanceOf(ThreadNotFoundError);
  });

});

// ⚠ **THE LIST'S OWN CASES LIVE IN `service-list.test.ts` SINCE WAVE 3 (R-26)** —
// the direct-peer case moved there with the projection, beside the roster sample it
// now shares one profile read with.
