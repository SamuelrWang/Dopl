/**
 * THE MENTION STAMP — the reserved key that decides whose Tags inbox a message
 * lands in (and, from Phase 7, who gets notified).
 *
 * ⚠ ITS OWN FILE for the reason the key is reserved at all: a caller-settable
 * mention set is a notification-forgery primitive, and that is a security
 * property a reader should find by name rather than fifteen describes down the
 * metadata fold's file.
 *
 * ⚠ EVERY CASE DRIVES THE REAL `postMessage` → `resolvePostMetadata` and reads
 * the metadata object that crossed into `insertMessage`. INVARIANTS §14: a
 * regex over source text is not a behavioural assertion — it goes red on a
 * refactor that changed nothing and green on a path that does the wrong thing.
 * The harness mirrors `service-writes-metadata-fanout.test.ts`'s deliberately.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./repository");
vi.mock("./repository-messages");
vi.mock("./repository-tasks");

import * as repo from "./repository";
import * as repoMessages from "./repository-messages";
import * as repoTasks from "./repository-tasks";
import { postMessage } from "./service-writes";
import { MENTIONS_METADATA_KEY } from "../lib/mentions";
import type {
  ChannelMemberRow,
  ChannelMessageRow,
  ChannelRow,
  ProfileRef,
} from "./dto";
import type { ChannelContext } from "./service-shared";

const WS = "ws-1";
const USER = "11111111-e29b-41d4-a716-446655440000";
const PEER = "22222222-e29b-41d4-a716-446655440000";
const THIRD = "33333333-e29b-41d4-a716-446655440000";
const ctx: ChannelContext = {
  workspaceId: WS,
  userId: USER,
  source: "user",
  role: "member",
};

function channelRow(overrides: Partial<ChannelRow> = {}): ChannelRow {
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
    ...overrides,
  };
}

function memberRow(userId: string, role = "member"): ChannelMemberRow {
  return {
    channel_id: "chan-1",
    user_id: userId,
    workspace_id: WS,
    role,
    last_read_at: null,
    notify_scope: "all",
    agent_tool_profile: "full",
    favorited_at: null,
    added_by: USER,
    joined_at: "2026-08-18T00:00:00Z",
  };
}

function profile(id: string, name: string, email: string): ProfileRef {
  return { id, display_name: name, email, avatar_url: null };
}

function insertedRow(
  row: Parameters<typeof repoMessages.insertMessage>[0]
): ChannelMessageRow {
  return {
    id: "msg-1",
    seq: 12,
    channel_id: row.channel_id,
    workspace_id: row.workspace_id,
    author_user_id: row.author_user_id,
    author_kind: row.author_kind,
    kind: row.kind,
    body: row.body,
    metadata: row.metadata,
    client_msg_id: row.client_msg_id,
    created_at: "2026-08-18T00:00:00Z",
  };
}

/** The metadata object handed to `repoMessages.insertMessage`. */
function capturedMetadata(): Record<string, unknown> {
  return vi.mocked(repoMessages.insertMessage).mock.calls[0][0].metadata;
}

function has(meta: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(meta, key);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(repo.findChannelBySlug).mockResolvedValue(channelRow());
  vi.mocked(repo.findMembership).mockImplementation(async (_c, userId) =>
    [USER, PEER, THIRD].includes(userId) ? memberRow(userId) : null
  );
  vi.mocked(repo.isActiveWorkspaceMember).mockResolvedValue(true);
  vi.mocked(repo.listMembers).mockResolvedValue([
    memberRow(USER, "owner"),
    memberRow(PEER),
    memberRow(THIRD),
  ]);
  vi.mocked(repo.fetchProfiles).mockResolvedValue([
    profile(USER, "Sam Wang", "sam@example.com"),
    profile(PEER, "Diana Taylor", "diana@example.com"),
    profile(THIRD, "Daniel Anderson", "dan@example.com"),
  ]);
  vi.mocked(repoMessages.findMessageByClientId).mockResolvedValue(null);
  vi.mocked(repo.touchChannel).mockResolvedValue(undefined);
  vi.mocked(repoMessages.insertMessage).mockImplementation(async (row) =>
    insertedRow(row)
  );
  vi.mocked(repoTasks.listTasksByChannel).mockResolvedValue({
    rows: [],
    truncated: false,
  });
});

describe("postMessage — the mention stamp (wiring plan Phase 6)", () => {
  it("stamps the roster-resolved ids, in first-appearance order", async () => {
    await postMessage(ctx, "room", { body: "@dan and @Diana, take a look" });
    expect(capturedMetadata()[MENTIONS_METADATA_KEY]).toEqual([THIRD, PEER]);
  });

  it("stamps NOTHING when the body tags nobody", async () => {
    await postMessage(ctx, "room", { body: "no tags here at all" });
    expect(has(capturedMetadata(), MENTIONS_METADATA_KEY)).toBe(false);
  });

  it("stamps NOTHING for a handle nobody in the roster answers to", async () => {
    await postMessage(ctx, "room", { body: "cc @nobody about this" });
    expect(has(capturedMetadata(), MENTIONS_METADATA_KEY)).toBe(false);
  });

  it("drops the AUTHOR — tagging yourself is not an inbox item", async () => {
    await postMessage(ctx, "room", { body: "@sam is on it, @diana FYI" });
    expect(capturedMetadata()[MENTIONS_METADATA_KEY]).toEqual([PEER]);
  });

  it("SECURITY: a caller-supplied mention set is STRIPPED, never honored", async () => {
    // ⚠ The key decides whose Tags inbox this message lands in. A caller able
    // to set it could put its words in anybody's inbox without naming them —
    // and Phase 7 gates notifications on the same key.
    await postMessage(ctx, "room", {
      body: "nothing tagged in this body",
      metadata: { [MENTIONS_METADATA_KEY]: [PEER, THIRD] },
    });
    expect(has(capturedMetadata(), MENTIONS_METADATA_KEY)).toBe(false);
  });

  it("SECURITY: a caller-supplied set is REPLACED by the server's own resolution, not merged", async () => {
    await postMessage(ctx, "room", {
      body: "@diana only",
      metadata: { [MENTIONS_METADATA_KEY]: [THIRD, "not-even-a-member"] },
    });
    expect(capturedMetadata()[MENTIONS_METADATA_KEY]).toEqual([PEER]);
  });

  it("does NOT address anybody — a mention is an inbox fact, not a trigger", async () => {
    // INVARIANTS §5: `to_user_id` comes from the validated `toUserId` and
    // nowhere else, at every member count. An @-tag must never become one.
    await postMessage(ctx, "room", { body: "@diana can you look?" });
    const meta = capturedMetadata();
    expect(meta[MENTIONS_METADATA_KEY]).toEqual([PEER]);
    expect(has(meta, "to_user_id")).toBe(false);
  });

  it("a mention outside the channel roster resolves to nobody", async () => {
    // The resolver only ever sees this channel's members, so a name that is not
    // in the room cannot be tagged into it.
    vi.mocked(repo.listMembers).mockResolvedValue([
      memberRow(USER, "owner"),
      memberRow(PEER),
    ]);
    await postMessage(ctx, "room", { body: "@dan is not in this room" });
    expect(has(capturedMetadata(), MENTIONS_METADATA_KEY)).toBe(false);
  });

  it("keeps the roster OFF the write path when the body carries no @", async () => {
    // ⚠ The cost argument (INVARIANTS §12: do not tax the hot write path).
    // A plain post in a plain channel must not pay a roster + profile read.
    await postMessage(ctx, "room", { body: "plain message, no tags" });
    expect(vi.mocked(repo.listMembers)).not.toHaveBeenCalled();
    // ⚠ `fetchProfiles` IS called once regardless — `postMessage` hydrates the
    // AUTHOR of the row it answers with, and that read predates this fold. What
    // must not happen is a second call for the whole roster.
    expect(vi.mocked(repo.fetchProfiles).mock.calls).toEqual([[[USER]]]);
  });

  it("pays for the roster ONCE when both inheritance and mentions want it", async () => {
    // A DM post that names its peer resolves a direct peer (fold 3) AND parses
    // mentions (fold 9). One `channel_members` read, memoized on the promise.
    vi.mocked(repo.findChannelBySlug).mockResolvedValue(
      channelRow({ is_direct: true, direct_key: [USER, PEER].sort().join(":") })
    );
    vi.mocked(repo.listMembers).mockResolvedValue([
      memberRow(USER, "owner"),
      memberRow(PEER),
    ]);
    await postMessage(ctx, "dm", { body: "@diana here you go", toUserId: PEER });
    expect(vi.mocked(repo.listMembers)).toHaveBeenCalledTimes(1);
  });
});
