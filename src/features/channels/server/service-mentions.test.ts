/**
 * THE MENTIONS INBOX — the projection and the mark-read write.
 *
 * Drives the real service over mocked repositories, so what is asserted is the
 * SHAPE the client boundary receives (§9: bounded, explicit, says when it
 * clipped) and the AUTHORIZATION of the write (an id that is not the caller's
 * mention writes nothing).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./repository");
vi.mock("./repository-mentions");

import * as repo from "./repository";
import * as repoMentions from "./repository-mentions";
import { listMyChannelMentions, markMentionsRead } from "./service-mentions";
import { CHANNEL_MENTION_LIST_LIMIT, MENTION_SNIPPET_MAX_CHARS } from "../constants";
import type { ChannelMemberRow, ChannelRow, ProfileRef } from "./dto";
import type { MentionMessageRow } from "./repository-mentions";
import type { ChannelContext } from "./service-shared";

const WS = "ws-1";
const USER = "11111111-e29b-41d4-a716-446655440000";
const PEER = "22222222-e29b-41d4-a716-446655440000";
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
    slug: "room",
    name: "Website",
    topic: "",
    visibility: "private",
    is_direct: false,
    direct_key: null,
    archived_at: null,
    deleted_at: null,
    created_at: "2026-08-18T00:00:00Z",
    updated_at: "2026-08-18T00:00:00Z",
  };
}

function memberRow(userId: string): ChannelMemberRow {
  return {
    channel_id: "chan-1",
    user_id: userId,
    workspace_id: WS,
    role: "member",
    last_read_at: null,
    notify_scope: "all",
    agent_tool_profile: "full",
    favorited_at: null,
    added_by: USER,
    joined_at: "2026-08-18T00:00:00Z",
  };
}

function messageRow(over: Partial<MentionMessageRow> = {}): MentionMessageRow {
  return {
    id: "m-9",
    seq: 9,
    channel_id: "chan-1",
    author_user_id: PEER,
    author_kind: "user",
    body: "@sam can you look at this?",
    metadata: {},
    created_at: "2026-08-18T12:00:00Z",
    ...over,
  };
}

const PROFILE: ProfileRef = {
  id: PEER,
  display_name: "Diana Taylor",
  email: "diana@example.com",
  avatar_url: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(repo.findChannelBySlug).mockResolvedValue(channelRow());
  vi.mocked(repo.findMembership).mockResolvedValue(memberRow(USER));
  vi.mocked(repo.fetchProfiles).mockResolvedValue([PROFILE]);
  vi.mocked(repoMentions.listMentionReads).mockResolvedValue(new Set());
  vi.mocked(repoMentions.insertMentionReads).mockResolvedValue(undefined);
});

describe("listMyChannelMentions", () => {
  it("projects the row, resolves the thread target and hydrates the author", async () => {
    vi.mocked(repoMentions.listMentionMessages).mockResolvedValue({
      rows: [messageRow({ metadata: { taskId: "t-1" } })],
      truncated: false,
    });
    const { mentions, truncated } = await listMyChannelMentions(ctx, "room");
    expect(truncated).toBe(false);
    expect(mentions).toEqual([
      {
        messageId: "m-9",
        seq: 9,
        channelId: "chan-1",
        threadId: "t-1",
        authorUserId: PEER,
        authorKind: "user",
        authorName: "Diana Taylor",
        authorAvatarUrl: null,
        snippet: "@sam can you look at this?",
        createdAt: "2026-08-18T12:00:00Z",
        read: false,
      },
    ]);
  });

  it("a channel-level post carries threadId null, never a guess", async () => {
    vi.mocked(repoMentions.listMentionMessages).mockResolvedValue({
      rows: [messageRow()],
      truncated: false,
    });
    const { mentions } = await listMyChannelMentions(ctx, "room");
    expect(mentions[0].threadId).toBeNull();
  });

  it("scopes the read to the CALLER — never to a subject from anywhere else", async () => {
    vi.mocked(repoMentions.listMentionMessages).mockResolvedValue({
      rows: [],
      truncated: false,
    });
    await listMyChannelMentions(ctx, "room");
    expect(vi.mocked(repoMentions.listMentionMessages)).toHaveBeenCalledWith(
      "chan-1",
      USER,
      CHANNEL_MENTION_LIST_LIMIT
    );
  });

  it("carries `truncated` through — a clipped page must not read as exhausted", async () => {
    vi.mocked(repoMentions.listMentionMessages).mockResolvedValue({
      rows: [messageRow()],
      truncated: true,
    });
    const { truncated } = await listMyChannelMentions(ctx, "room");
    expect(truncated).toBe(true);
  });

  it("clips the snippet and says so with an ellipsis; a short body keeps its exact text", async () => {
    const long = "x".repeat(MENTION_SNIPPET_MAX_CHARS + 50);
    vi.mocked(repoMentions.listMentionMessages).mockResolvedValue({
      rows: [messageRow({ body: long }), messageRow({ id: "m-8", body: "  short\n\n body " })],
      truncated: false,
    });
    const { mentions } = await listMyChannelMentions(ctx, "room");
    expect(mentions[0].snippet.length).toBe(MENTION_SNIPPET_MAX_CHARS + 1);
    expect(mentions[0].snippet.endsWith("…")).toBe(true);
    // Whitespace collapsed, no ellipsis: nothing was dropped.
    expect(mentions[1].snippet).toBe("short body");
  });

  it("marks a row read off the read-state set", async () => {
    vi.mocked(repoMentions.listMentionMessages).mockResolvedValue({
      rows: [messageRow(), messageRow({ id: "m-8", seq: 8 })],
      truncated: false,
    });
    vi.mocked(repoMentions.listMentionReads).mockResolvedValue(new Set(["m-8"]));
    const { mentions } = await listMyChannelMentions(ctx, "room");
    expect(mentions.map((m) => m.read)).toEqual([false, true]);
  });

  it("skips both hydration reads entirely on an empty page", async () => {
    vi.mocked(repoMentions.listMentionMessages).mockResolvedValue({
      rows: [],
      truncated: false,
    });
    const { mentions } = await listMyChannelMentions(ctx, "room");
    expect(mentions).toEqual([]);
    expect(vi.mocked(repoMentions.listMentionReads)).not.toHaveBeenCalled();
    expect(vi.mocked(repo.fetchProfiles)).not.toHaveBeenCalled();
  });
});

describe("markMentionsRead", () => {
  it("writes a row per ACCEPTED id, carrying the resolved channel + workspace", async () => {
    vi.mocked(repoMentions.findMentionMessageIds).mockResolvedValue(["m-9", "m-8"]);
    const { marked } = await markMentionsRead(ctx, "room", ["m-9", "m-8"]);
    expect(marked).toBe(2);
    expect(vi.mocked(repoMentions.insertMentionReads)).toHaveBeenCalledWith([
      { user_id: USER, message_id: "m-9", channel_id: "chan-1", workspace_id: WS },
      { user_id: USER, message_id: "m-8", channel_id: "chan-1", workspace_id: WS },
    ]);
  });

  it("SECURITY: an id that is not the caller's mention writes NOTHING", async () => {
    // ⚠ The filter IS the authorization: without it a caller could write
    // read-state rows for arbitrary ids, which probes which ids exist.
    vi.mocked(repoMentions.findMentionMessageIds).mockResolvedValue([]);
    const { marked } = await markMentionsRead(ctx, "room", ["someone-elses"]);
    expect(marked).toBe(0);
    expect(vi.mocked(repoMentions.insertMentionReads)).toHaveBeenCalledWith([]);
  });

  it("de-dupes the caller's ids before asking the database about them", async () => {
    vi.mocked(repoMentions.findMentionMessageIds).mockResolvedValue(["m-9"]);
    await markMentionsRead(ctx, "room", ["m-9", "m-9", "m-9"]);
    expect(vi.mocked(repoMentions.findMentionMessageIds)).toHaveBeenCalledWith(
      "chan-1",
      USER,
      ["m-9"]
    );
  });

  it("re-marking an already-read mention still reports it marked", async () => {
    // Idempotent by `ON CONFLICT DO NOTHING`; `marked` counts ACCEPTED ids, not
    // rows inserted, or the second click of a double click reports failure.
    vi.mocked(repoMentions.findMentionMessageIds).mockResolvedValue(["m-9"]);
    const first = await markMentionsRead(ctx, "room", ["m-9"]);
    const second = await markMentionsRead(ctx, "room", ["m-9"]);
    expect(first).toEqual({ marked: 1 });
    expect(second).toEqual({ marked: 1 });
  });
});
