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
// ⚠ THE SESSION REPOSITORY, NOT `service-shared`: `agentNamesFor` lives in shared
// beside `loadVisibleChannel` and `profilesById`, which this suite needs REAL.
// Mocking the module would stub the gate it depends on; mocking the one query it
// makes leaves the derivation under test.
vi.mock("./repository-sessions");

import * as repo from "./repository";
import * as repoMentions from "./repository-mentions";
import * as repoSessions from "./repository-sessions";
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
    client_msg_id: null,
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
  vi.mocked(repoSessions.agentDisplayNames).mockResolvedValue(new Map());
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
        // ⚠ A HUMAN's row: both agent fields are null, and that is CANNOT SAY
        // rather than "not an agent" — `authorKind` is what answers that.
        authorAgentId: null,
        authorAgentName: null,
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

/**
 * WHICH AGENT TAGGED YOU (2026-09-15) — the inbox row names the agent, so the
 * projection has to carry its id and its operator's name for it.
 *
 * ⚠ THE ID COMES FROM THE ONE PARSER (`lib/agent-post-stamp.ts ›
 * authorAgentIdOf`: the `client_msg_id` stamp, else the server's own
 * `metadata.session_id`), and the NAME from the same page-wide join the
 * transcript makes. Two readers of one fact would let the inbox and the message
 * it points at name the agent differently, which is the drift this whole
 * feature carries warnings about.
 */
describe("listMyChannelMentions — which agent wrote it", () => {
  it("names the agent off the post stamp, with its operator's name for it", async () => {
    vi.mocked(repoMentions.listMentionMessages).mockResolvedValue({
      rows: [
        messageRow({
          author_kind: "agent",
          client_msg_id: "agent-deynelz3-41",
        }),
      ],
      truncated: false,
    });
    vi.mocked(repoSessions.agentDisplayNames).mockResolvedValue(
      new Map([["deynelz3", "Bug reviewer"]])
    );
    const { mentions } = await listMyChannelMentions(ctx, "room");
    expect(mentions[0]!.authorAgentId).toBe("deynelz3");
    expect(mentions[0]!.authorAgentName).toBe("Bug reviewer");
  });

  it("falls back to the SESSION KEY when the post carried its own idempotency key", async () => {
    // The Mobile Command Center case: an agent that passes its own
    // `client_msg_id` is anonymous to the stamp, and `metadata.session_id` is the
    // stronger fact anyway — server-stamped, so it cannot be posed.
    vi.mocked(repoMentions.listMentionMessages).mockResolvedValue({
      rows: [
        messageRow({
          author_kind: "agent",
          client_msg_id: "reply-2",
          metadata: { session_id: "chan-1::o9wj5bzn" },
        }),
      ],
      truncated: false,
    });
    vi.mocked(repoSessions.agentDisplayNames).mockResolvedValue(new Map());
    const { mentions } = await listMyChannelMentions(ctx, "room");
    expect(mentions[0]!.authorAgentId).toBe("o9wj5bzn");
    // ⚠ NO NAME IS NOT NO AGENT: the id still renders, as `#o9wj5bzn`.
    expect(mentions[0]!.authorAgentName).toBeNull();
  });

  it("a HUMAN's row is never given an agent id, whatever its client_msg_id looks like", async () => {
    // ⚠ THE GUARD THAT MATTERS: `client_msg_id` is caller-supplied, so a person
    // whose client happened to pick the stamp shape must not be attributed to an
    // agent that does not exist.
    vi.mocked(repoMentions.listMentionMessages).mockResolvedValue({
      rows: [messageRow({ author_kind: "user", client_msg_id: "agent-deynelz3-41" })],
      truncated: false,
    });
    const { mentions } = await listMyChannelMentions(ctx, "room");
    expect(mentions[0]!.authorAgentId).toBeNull();
    expect(mentions[0]!.authorAgentName).toBeNull();
  });
});
