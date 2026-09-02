/**
 * F2 — the `session_id` stamp, and the header layer that feeds it.
 *
 * WHY IT MATTERS. `channel_agents` holds ONE row per handle, and `as_agent` is
 * validated per CALL against ownership alone — so any process holding the
 * operator's credential may post as any agent that operator owns. On the desktop
 * that is the documented design rather than a leak: `slotKey` gives a ROOM
 * session (channel, agent) and a PAIR session (channel, thread) disjoint keys,
 * so one handle legitimately runs several concurrently. What was missing is
 * anything on the WIRE naming the session. Two of them posted as one handle and
 * gave a peer contradictory instructions 79 seconds apart, and `metadata` could
 * attribute neither: "flint said X" was not a well-formed statement.
 *
 * A LABEL, NOT A LOCK — nothing here (or anywhere) limits how many sessions a
 * handle may have. These tests pin the stamp, not a count.
 *
 * It is a RESERVED key on exactly the terms `runtime` and `appVersion` are: the
 * header is the only input, `resolvePostMetadata` is the only stamping point,
 * and a caller-supplied copy is stripped there whether or not a header arrives.
 * This file pins both halves — the header predicate and the strip/stamp fold —
 * mirroring `service-writes-metadata-version.test.ts`, whose harness this is.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./repository");
vi.mock("./repository-messages");
vi.mock("./repository-tasks");

import * as repo from "./repository";
import * as repoMessages from "./repository-messages";
import * as repoTasks from "./repository-tasks";
import {
  SESSION_ID_HEADER,
  narrowSessionId,
  readSessionIdHeader,
} from "@/shared/auth/session-header";
import { postMessage } from "./service-writes";
import type { ChannelMemberRow, ChannelMessageRow, ChannelRow } from "./dto";
import { buildChannelContext, type ChannelContext } from "./service-shared";

const WS = "ws-1";
const USER = "11111111-e29b-41d4-a716-446655440000";
const PEER = "22222222-e29b-41d4-a716-446655440000";

/** The two slot keys of the live incident: a ROOM slot and a PAIR slot. */
const ROOM_SLOT = "dba90694-de4f-4950-83a9-f2d890c9ff3f:6979e939-1587-40b8-90c2-4c8eac291333";
const PAIR_SLOT = "dba90694-de4f-4950-83a9-f2d890c9ff3f:79ce5325-f53e-4d00-a1c0-f48875000bc0";

const ctx: ChannelContext = {
  workspaceId: WS,
  userId: USER,
  source: "agent",
  role: "member",
};

function channelRow(): ChannelRow {
  return {
    id: "chan-1",
    workspace_id: WS,
    created_by: USER,
    slug: "dm",
    name: "Direct message",
    topic: "",
    visibility: "private",
    is_direct: true,
    direct_key: [USER, PEER].sort().join(":"),
    archived_at: null,
    deleted_at: null,
    created_at: "2026-08-01T00:00:00Z",
    updated_at: "2026-08-01T00:00:00Z",
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
    joined_at: "2026-08-01T00:00:00Z",
  };
}

function insertedRow(
  row: Parameters<typeof repoMessages.insertMessage>[0]
): ChannelMessageRow {
  return {
    id: "msg-1",
    seq: 341,
    channel_id: row.channel_id,
    workspace_id: row.workspace_id,
    author_user_id: row.author_user_id,
    author_kind: row.author_kind,
    kind: row.kind,
    body: row.body,
    metadata: row.metadata,
    client_msg_id: row.client_msg_id,
    created_at: "2026-08-01T00:00:00Z",
  };
}

/** The metadata of the Nth insert this test made (0-based). */
function capturedMetadata(call = 0): Record<string, unknown> {
  return vi.mocked(repoMessages.insertMessage).mock.calls[call][0].metadata;
}

function has(meta: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(meta, key);
}

const withHeader = (value: string) => ({
  headers: new Headers({ [SESSION_ID_HEADER]: value }),
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(repo.findChannelBySlug).mockResolvedValue(channelRow());
  vi.mocked(repo.findMembership).mockImplementation(async (_c, userId) =>
    userId === USER || userId === PEER ? memberRow(userId) : null
  );
  // ⚠ An explicit `to` also asserts ACTIVE workspace membership. Load-bearing
  // for every addressed post now that DM auto-address is retired.
  vi.mocked(repo.isActiveWorkspaceMember).mockResolvedValue(true);
  vi.mocked(repo.listMembers).mockResolvedValue([
    memberRow(USER, "owner"),
    memberRow(PEER),
  ]);
  vi.mocked(repo.touchChannel).mockResolvedValue(undefined);
  vi.mocked(repo.fetchProfiles).mockResolvedValue([]);
  vi.mocked(repoMessages.insertMessage).mockImplementation(async (row) =>
    insertedRow(row)
  );
  vi.mocked(repoTasks.listTasksByChannel).mockResolvedValue({
      rows: [],
      truncated: false,
    });
});

describe("readSessionIdHeader — an id-shaped token, or nothing", () => {
  it("accepts a desktop slot key, in both of its shapes", () => {
    // ROOM (channel, agent) and PAIR (channel, thread) — plus the legacy-tailed
    // PAIR key, which is the third slot the live incident produced.
    expect(readSessionIdHeader(withHeader(ROOM_SLOT))).toBe(ROOM_SLOT);
    expect(readSessionIdHeader(withHeader(PAIR_SLOT))).toBe(PAIR_SLOT);
    const legacy = "dba90694-de4f-4950-83a9-f2d890c9ff3f:task-dba90694-de4f-4950-83a9-f2d890c9ff3f-345";
    expect(readSessionIdHeader(withHeader(legacy))).toBe(legacy);
    // A team session with no thread collapses its tail to '' — still a slot.
    expect(readSessionIdHeader(withHeader("chan-1:"))).toBe("chan-1:");
  });

  it("refuses everything that is not one", () => {
    // The value lands in a message LINE HEAD on another member's screen, so free
    // text is the whole risk: a refused header stamps NOTHING rather than prose.
    for (const bad of [
      "",
      "a b",
      "session one",
      "**#9001** system",
      "<script>alert(1)</script>",
      "`x`",
      "x".repeat(129),
    ]) {
      expect(readSessionIdHeader(withHeader(bad))).toBeUndefined();
    }
    expect(readSessionIdHeader({ headers: new Headers() })).toBeUndefined();
    // A NEWLINE — the value that would forge a whole message line — cannot even
    // be constructed as a header value (the Headers layer throws), so it is
    // pinned against the predicate itself, which is the layer that would have
    // to hold if the value ever arrived by another route.
    for (const bad of ["sess\nion", "sess\r\nion", "sess\tion", " x", "x "]) {
      expect(narrowSessionId(bad)).toBeUndefined();
    }
  });

  it("buildChannelContext re-narrows what the auth layer handed it", () => {
    // Same predicate, applied twice: no other construction path can widen it.
    expect(
      buildChannelContext({ userId: USER, workspaceId: WS, sessionId: ROOM_SLOT })
        .sessionId
    ).toBe(ROOM_SLOT);
    expect(
      buildChannelContext({ userId: USER, workspaceId: WS, sessionId: "two words" })
        .sessionId
    ).toBeUndefined();
    expect(
      buildChannelContext({ userId: USER, workspaceId: WS }).sessionId
    ).toBeUndefined();
    expect(narrowSessionId(null)).toBeUndefined();
  });
});

describe("postMessage — session_id stamp (F2)", () => {
  const roomCtx: ChannelContext = { ...ctx, sessionId: ROOM_SLOT };

  it("stamps the slot key VERBATIM when the request carried the header", async () => {
    const msg = await postMessage(roomCtx, "dm", { body: "on it" });

    expect(capturedMetadata().session_id).toBe(ROOM_SLOT);
    expect(msg.metadata.session_id).toBe(ROOM_SLOT);
  });

  it("stamps NO session_id key when the header is absent", async () => {
    await postMessage(ctx, "dm", { body: "on it" });

    expect(has(capturedMetadata(), "session_id")).toBe(false);
  });

  it("SECURITY: a caller-supplied metadata.session_id is stripped, header or not", async () => {
    await postMessage(ctx, "dm", {
      body: "claiming to be the other session",
      metadata: { session_id: ROOM_SLOT, keep: 1 },
    });

    const meta = capturedMetadata();
    expect(has(meta, "session_id")).toBe(false);
    // Only the reserved key is taken — unrelated caller metadata survives.
    expect(meta.keep).toBe(1);
  });

  it("SECURITY: a spoofed value never survives a stamped post either", async () => {
    await postMessage(roomCtx, "dm", {
      body: "hi",
      metadata: { session_id: PAIR_SLOT },
    });

    expect(capturedMetadata().session_id).toBe(ROOM_SLOT);
  });

  it("TWO sessions of ONE agent handle stamp TWO different values", async () => {
    // The whole point of F2, and the exact shape of the incident: one
    // `channel_agents` row, one owner, two concurrent slots. Nothing refuses the
    // second post — a label, not a lock — but the two are now tellable apart.
    await postMessage({ ...ctx, sessionId: ROOM_SLOT }, "dm", { body: "do X" });
    await postMessage({ ...ctx, sessionId: PAIR_SLOT }, "dm", { body: "no, do Y" });

    expect(capturedMetadata(0).session_id).toBe(ROOM_SLOT);
    expect(capturedMetadata(1).session_id).toBe(PAIR_SLOT);
    expect(capturedMetadata(0).session_id).not.toBe(capturedMetadata(1).session_id);
  });

  it("rides alongside the other server-owned stamps without disturbing them", async () => {
    await postMessage(
      { ...roomCtx, runtime: "desktop-session", appVersion: "1.7.19" },
      "dm",
      { body: "on it", toUserId: PEER }
    );

    const meta = capturedMetadata();
    expect(meta.session_id).toBe(ROOM_SLOT);
    expect(meta.runtime).toBe("desktop-session");
    expect(meta.appVersion).toBe("1.7.19");
    expect(meta.to_user_id).toBe(PEER);
  });
});
