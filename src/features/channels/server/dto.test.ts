/**
 * Unit tests for the channels DTO mappers (pure functions — no DB).
 * Covers the snake_case → camelCase row mapping, the derived `unread` /
 * `isMember` flags, the `notify_scope` default, the `metadata` object guard,
 * and the author-display fallback chain.
 */

import { describe, it, expect } from "vitest";
import {
  mapChannelRow,
  mapMemberRow,
  mapMessageRow,
  mapTaskRow,
  type ChannelMemberRow,
  type ChannelMessageRow,
  type ChannelRow,
  type ChannelTaskRow,
  type ChannelViewerState,
  type ProfileRef,
} from "./dto";

function channelRow(overrides: Partial<ChannelRow> = {}): ChannelRow {
  return {
    id: "chan-1",
    workspace_id: "ws-1",
    created_by: "user-1",
    slug: "general",
    name: "General",
    topic: "chatter",
    visibility: "public",
    is_direct: false,
    direct_key: null,
    archived_at: null,
    deleted_at: null,
    created_at: "2026-07-20T00:00:00Z",
    updated_at: "2026-07-21T00:00:00Z",
    ...overrides,
  };
}

function viewerState(overrides: Partial<ChannelViewerState> = {}): ChannelViewerState {
  return {
    memberCount: 3,
    lastMessageAt: null,
    role: null,
    lastReadAt: null,
    notifyScope: null,
    agentToolProfile: null,
    favoritedAt: null,
    onlineMemberCount: 0,
    directPeer: null,
    ...overrides,
  };
}

describe("mapChannelRow", () => {
  it("maps snake_case columns to the camelCase DTO", () => {
    const dto = mapChannelRow(channelRow(), viewerState({ memberCount: 5 }));
    expect(dto).toMatchObject({
      id: "chan-1",
      workspaceId: "ws-1",
      createdBy: "user-1",
      slug: "general",
      name: "General",
      topic: "chatter",
      visibility: "public",
      archivedAt: null,
      createdAt: "2026-07-20T00:00:00Z",
      updatedAt: "2026-07-21T00:00:00Z",
      memberCount: 5,
    });
  });

  it("isMember reflects a non-null role", () => {
    expect(mapChannelRow(channelRow(), viewerState({ role: null })).isMember).toBe(false);
    expect(mapChannelRow(channelRow(), viewerState({ role: "member" })).isMember).toBe(true);
  });

  it("passes the caller's own notify scope through as myNotifyScope", () => {
    const dto = mapChannelRow(channelRow(), viewerState({ role: "owner", notifyScope: "none" }));
    expect(dto.myNotifyScope).toBe("none");
  });

  describe("unread flag", () => {
    it("is false for a non-member regardless of activity", () => {
      const dto = mapChannelRow(
        channelRow(),
        viewerState({ role: null, lastMessageAt: "2026-07-21T00:00:00Z" })
      );
      expect(dto.unread).toBe(false);
    });

    it("is true for a member who never read a channel that has messages", () => {
      const dto = mapChannelRow(
        channelRow(),
        viewerState({ role: "member", lastMessageAt: "2026-07-21T00:00:00Z", lastReadAt: null })
      );
      expect(dto.unread).toBe(true);
    });

    it("compares instants across differing ISO formats (Postgres +00:00 µs vs JS Z ms)", () => {
      // lastMessageAt is a Postgres timestamp; lastReadAt is a JS toISOString().
      // A lexicographic compare would be wrong — Date.parse normalizes both.
      const unread = mapChannelRow(
        channelRow(),
        viewerState({
          role: "member",
          lastMessageAt: "2026-07-21T00:00:00.500000+00:00",
          lastReadAt: "2026-07-21T00:00:00.100Z",
        })
      ).unread;
      expect(unread).toBe(true);

      const read = mapChannelRow(
        channelRow(),
        viewerState({
          role: "member",
          lastMessageAt: "2026-07-21T00:00:00.100000+00:00",
          lastReadAt: "2026-07-21T00:00:00.500Z",
        })
      ).unread;
      expect(read).toBe(false);
    });

    it("is false when the channel has no messages", () => {
      const dto = mapChannelRow(
        channelRow(),
        viewerState({ role: "member", lastMessageAt: null })
      );
      expect(dto.unread).toBe(false);
    });
  });
});

describe("mapMemberRow", () => {
  const row: ChannelMemberRow = {
    channel_id: "chan-1",
    user_id: "user-2",
    workspace_id: "ws-1",
    role: "member",
    last_read_at: "2026-07-21T00:00:00Z",
    notify_scope: "addressed",
    agent_tool_profile: "read_only",
    favorited_at: null,
    added_by: "user-1",
    joined_at: "2026-07-20T00:00:00Z",
  };

  /** The row belongs to user-2, so this is the "viewing my own row" case. */
  const asSelf = { viewerUserId: "user-2" };

  it("maps snake_case columns to the camelCase DTO", () => {
    const dto = mapMemberRow(row, undefined, asSelf);
    expect(dto).toMatchObject({
      channelId: "chan-1",
      userId: "user-2",
      role: "member",
      lastReadAt: "2026-07-21T00:00:00Z",
      notifyScope: "addressed",
      agentToolProfile: "read_only",
      addedBy: "user-1",
      joinedAt: "2026-07-20T00:00:00Z",
    });
  });

  it("scrubs private preferences on ANOTHER member's row (L-5 invariant)", () => {
    // The scrub is the mapper's job, not each caller's: every path that
    // returns a member DTO (roster read, addMember, updateMyMemberSettings)
    // gets it for free. A teammate must not learn who muted the channel or
    // how tightly another operator's agent is scoped.
    expect(
      mapMemberRow(
        { ...row, favorited_at: "2026-08-19T10:00:00Z" },
        undefined,
        { viewerUserId: "someone-else" }
      )
    ).toMatchObject({
      userId: "user-2",
      notifyScope: null,
      agentToolProfile: null,
      // ⚠ `favorited_at` joined the scrub in the same change that added the
      // column (2026-08-19). It is one half of INVARIANTS §2's two-edit rule for
      // a new per-member setting; the other half is its absence from
      // `20260810120000`'s GRANT list, which is what binds PostgREST and CDC.
      favoritedAt: null,
    });
  });

  it("shows favoritedAt on the viewer's OWN row", () => {
    expect(
      mapMemberRow({ ...row, favorited_at: "2026-08-19T10:00:00Z" }, undefined, asSelf)
    ).toMatchObject({ favoritedAt: "2026-08-19T10:00:00Z" });
    // Not favourited is `null`, never absent — the field always answers.
    expect(mapMemberRow(row, undefined, asSelf)).toMatchObject({
      favoritedAt: null,
    });
  });

  it("keeps presence public even on another member's row", () => {
    // You need to know whether the agent you're addressing is live.
    expect(
      mapMemberRow(row, undefined, {
        viewerUserId: "someone-else",
        presence: { online: true, lastSeenAt: "2026-07-26T00:00:00Z" },
      })
    ).toMatchObject({ agentOnline: true, lastSeenAt: "2026-07-26T00:00:00Z" });
  });

  it("derives presence: offline by default, online + lastSeenAt when supplied", () => {
    expect(mapMemberRow(row, undefined, asSelf)).toMatchObject({
      agentOnline: false,
      lastSeenAt: null,
    });
    expect(
      mapMemberRow(row, undefined, {
        ...asSelf,
        presence: { online: true, lastSeenAt: "2026-07-26T00:00:00Z" },
      })
    ).toMatchObject({ agentOnline: true, lastSeenAt: "2026-07-26T00:00:00Z" });
  });

  it("hydrates profile fields, null when no profile is supplied", () => {
    const profile: ProfileRef = {
      id: "user-2",
      email: "b@x.com",
      display_name: "Bee",
      avatar_url: "http://x/a.png",
    };
    expect(mapMemberRow(row, profile, asSelf)).toMatchObject({
      displayName: "Bee",
      email: "b@x.com",
      avatarUrl: "http://x/a.png",
    });
    expect(mapMemberRow(row, undefined, asSelf)).toMatchObject({
      displayName: null,
      email: null,
      avatarUrl: null,
    });
  });
});

describe("mapMessageRow", () => {
  function messageRow(overrides: Partial<ChannelMessageRow> = {}): ChannelMessageRow {
    return {
      id: "msg-1",
      seq: 7,
      channel_id: "chan-1",
      workspace_id: "ws-1",
      author_user_id: "user-2",
      author_kind: "user",
      kind: "message",
      body: "hi",
      metadata: { to_user_id: "user-3" },
      client_msg_id: "c-1",
      created_at: "2026-07-21T00:00:00Z",
      ...overrides,
    };
  }

  it("maps columns and coerces seq to a number", () => {
    const dto = mapMessageRow(messageRow({ seq: 7 }), undefined);
    expect(dto).toMatchObject({
      id: "msg-1",
      seq: 7,
      channelId: "chan-1",
      authorUserId: "user-2",
      authorKind: "user",
      kind: "message",
      body: "hi",
      clientMsgId: "c-1",
      metadata: { to_user_id: "user-3" },
    });
    expect(typeof dto.seq).toBe("number");
  });

  it("defaults non-object metadata to an empty object", () => {
    expect(mapMessageRow(messageRow({ metadata: null }), undefined).metadata).toEqual({});
    expect(mapMessageRow(messageRow({ metadata: "oops" }), undefined).metadata).toEqual({});
    expect(mapMessageRow(messageRow({ metadata: [1, 2] }), undefined).metadata).toEqual({});
  });

  it("author display falls back display_name -> email -> null", () => {
    expect(
      mapMessageRow(messageRow(), {
        id: "user-2",
        email: "b@x.com",
        display_name: "Bee",
        avatar_url: null,
      }).authorName
    ).toBe("Bee");

    expect(
      mapMessageRow(messageRow(), {
        id: "user-2",
        email: "b@x.com",
        display_name: null,
        avatar_url: null,
      }).authorName
    ).toBe("b@x.com");

    expect(mapMessageRow(messageRow(), undefined).authorName).toBeNull();
  });

  /**
   * **THE AGENT BEHIND AN AGENT-AUTHORED ROW, BY THE NAME ITS OPERATOR GAVE IT**
   * (2026-09-04).
   *
   * ⚠ **JOINED PER PAGE, NEVER STORED.** The MCP read printed `agent for
   * <operator>` and a bare id tail for a session its operator had renamed, so a
   * reader had the operator's name and eight characters of id and no way to join
   * them. A copy on the message row would stop agreeing the first time the
   * operator renames.
   */
  describe("authorAgentName", () => {
    const NAMES = new Map([["k3v7d2mq", "Mobile Main"]]);

    it("resolves off the client_msg_id STAMP", () => {
      const dto = mapMessageRow(
        messageRow({ author_kind: "agent", client_msg_id: "agent-k3v7d2mq-4" }),
        undefined,
        NAMES
      );
      expect(dto.authorAgentName).toBe("Mobile Main");
    });

    it("resolves off the server's own SESSION stamp — the post that chose its own key", () => {
      const dto = mapMessageRow(
        messageRow({
          author_kind: "agent",
          client_msg_id: "my-own-key",
          metadata: { session_id: "chan-1::k3v7d2mq" },
        }),
        undefined,
        NAMES
      );
      expect(dto.authorAgentName).toBe("Mobile Main");
    });

    it("🔒 is null for a PERSON — a cookie session carries a session_id too", () => {
      const dto = mapMessageRow(
        messageRow({
          author_kind: "user",
          metadata: { session_id: "chan-1::k3v7d2mq" },
        }),
        undefined,
        NAMES
      );
      expect(dto.authorAgentName).toBeNull();
    });

    it("is null for an unnamed agent, and for a page with no join at all", () => {
      // ⚠ THREE SITUATIONS, ONE ANSWER, and every renderer falls back to the
      // `agent-<id>` handle: no name reported, no id derivable, no map passed.
      expect(
        mapMessageRow(
          messageRow({ author_kind: "agent", client_msg_id: "agent-zzzzzzzz-1" }),
          undefined,
          NAMES
        ).authorAgentName
      ).toBeNull();
      expect(
        mapMessageRow(
          messageRow({ author_kind: "agent", client_msg_id: "agent-k3v7d2mq-4" }),
          undefined
        ).authorAgentName
      ).toBeNull();
    });
  });
});

describe("mapTaskRow", () => {
  function taskRow(overrides: Partial<ChannelTaskRow> = {}): ChannelTaskRow {
    return {
      id: "task-1",
      channel_id: "chan-1",
      workspace_id: "ws-1",
      title: "Ship it",
      status: "closed",
      outcome: "completed",
      mode: "interactive",
      created_by: "user-1",
      target_user_id: "user-2",
      created_at: "2026-07-20T00:00:00Z",
      updated_at: "2026-07-21T00:00:00Z",
      closed_at: "2026-07-21T00:00:00Z",
      outcome_summary: "Shipped v2 to prod",
      ...overrides,
    };
  }

  it("maps outcome_summary to outcomeSummary", () => {
    expect(mapTaskRow(taskRow()).outcomeSummary).toBe("Shipped v2 to prod");
  });

  it("defaults a null outcome_summary to null", () => {
    expect(mapTaskRow(taskRow({ outcome_summary: null })).outcomeSummary).toBeNull();
  });
});
