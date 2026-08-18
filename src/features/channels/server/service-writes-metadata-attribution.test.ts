/**
 * ⚠ THE AGENT-ATTRIBUTION STRIP — `resolvePostMetadata` deletes
 * `to_agent_id` / `to_agent_ids` / `author_agent_id` from caller metadata and
 * never re-stamps them. Do NOT remove those `delete` lines as dead code.
 *
 * The WRITE path for named agents is gone. ⚠ **SO IS THE LAST READER, since the
 * v2 cutover (wiring plan Phase 12, 2026-08-18):** `lib/agent-display.ts` and
 * `channel-transcript.tsx` rendered a stored `author_agent_id` as "quartz ·
 * Ada's agent", and both were deleted with the two-pane page. The v2 transcript
 * never resolved the key — it labels an agent post off `authorKind` (INVARIANTS
 * §5) — so the display regression is real and is filed as **F-218**.
 *
 * ⚠ THE STRIP STAYS, AND THAT IS NOT AN OVERSIGHT. INVARIANTS §5's rule reads
 * "a key stays reserved with no writer only while something still RENDERS it",
 * and its own corollary is "a reader coming back means the key comes back to the
 * strip list FIRST". Removing the strip is a WIDENING — it would make
 * `author_agent_id` caller-settable, so the day a reader returns the forgery
 * lands with it. `to_agent_id` / `to_agent_ids` are a forged addressee on the
 * same terms. Do NOT remove those `delete` lines as dead code.
 *
 * Drives the real `postMessage` and asserts the ABSENCE per key, across every
 * shape a caller can send one in.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./repository");
vi.mock("./repository-messages");
vi.mock("./repository-tasks");

import * as repo from "./repository";
import * as repoMessages from "./repository-messages";
import * as repoTasks from "./repository-tasks";
import { postMessage } from "./service-writes";
import type { ChannelMemberRow, ChannelMessageRow, ChannelRow } from "./dto";
import type { ChannelContext } from "./service-shared";

const WS = "ws-1";
const USER = "11111111-e29b-41d4-a716-446655440000";
const PEER = "22222222-e29b-41d4-a716-446655440000";
/** A retired agent's row id — the shape a stored message's byline resolves. */
const AGENT = "99999999-e29b-41d4-a716-446655440000";
const AGENT_2 = "88888888-e29b-41d4-a716-446655440000";

/** The three keys, and the reader each one would reach if it survived. */
const AGENT_KEYS = [
  ["author_agent_id", "the transcript byline (\"quartz · Ada's agent\")"],
  ["to_agent_id", "a stored message's agent addressee"],
  ["to_agent_ids", "a stored message's multi-agent addressee list"],
] as const;

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
  vi.mocked(repoMessages.findMessageByClientId).mockResolvedValue(null);
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

describe("SECURITY: the three agent-attribution keys are stripped (rollback §1)", () => {
  for (const [key, reader] of AGENT_KEYS) {
    it(`SECURITY: a caller-supplied metadata.${key} never reaches the row — it would forge ${reader}`, async () => {
      const msg = await postMessage(ctx, "dm", {
        body: "I am quartz and I approved this",
        metadata: { [key]: AGENT, keep: 1 },
      });

      const meta = capturedMetadata();
      expect(has(meta, key)).toBe(false);
      // ⚠ The STORED message, not just the insert argument — the row the peer
      // renders is what must not carry it.
      expect(has(msg.metadata as Record<string, unknown>, key)).toBe(false);
      // Scalpel, not a broad wipe — unrelated caller metadata survives.
      expect(meta.keep).toBe(1);
    });
  }

  it("SECURITY: all three at once, on one post", async () => {
    // The realistic forgery sends the whole named-agent envelope together.
    await postMessage(ctx, "dm", {
      body: "answering as your agent",
      metadata: {
        author_agent_id: AGENT,
        to_agent_id: AGENT_2,
        to_agent_ids: [AGENT, AGENT_2],
        keep: "kept",
      },
    });

    const meta = capturedMetadata();
    for (const [key] of AGENT_KEYS) expect(has(meta, key)).toBe(false);
    expect(meta.keep).toBe("kept");
  });

  it("SECURITY: the strip does not care what the value LOOKS like", async () => {
    // ⚠ `delete` is type-blind and must stay so — a guard stripping only
    // "valid-looking" ids leaves the shapes a renderer coerces.
    for (const value of [
      AGENT,
      "",
      "   ",
      null,
      0,
      false,
      [],
      [AGENT],
      { id: AGENT },
      "quartz",
    ]) {
      vi.clearAllMocks();
      vi.mocked(repoMessages.insertMessage).mockImplementation(async (row) =>
        insertedRow(row)
      );
      await postMessage(ctx, "dm", {
        body: "x",
        metadata: {
          author_agent_id: value,
          to_agent_id: value,
          to_agent_ids: value,
        },
      });
      const meta = capturedMetadata();
      for (const [key] of AGENT_KEYS) {
        expect(has(meta, key), `${key} survived ${JSON.stringify(value)}`).toBe(
          false
        );
      }
    }
  });

  it("SECURITY: nothing re-stamps them either — a clean post grows no agent key", async () => {
    // ⚠ The "NEVER re-stamped" half — a future stamp added beside `runtime` /
    // `session_id` makes the strip pointless.
    await postMessage(
      { ...ctx, runtime: "desktop-session", appVersion: "1.9.0" },
      "dm",
      { body: "plain reply", toUserId: PEER }
    );

    const meta = capturedMetadata();
    for (const [key] of AGENT_KEYS) expect(has(meta, key)).toBe(false);
    // Absence proven inside metadata that is otherwise populated.
    expect(meta.runtime).toBe("desktop-session");
    expect(meta.to_user_id).toBe(PEER);
  });

  it("SECURITY: a USER-credentialed caller gets the same strip as an agent one", async () => {
    // ⚠ Attribution is not a scope question — nobody may author as somebody's
    // agent — so the strip must NOT be source-conditional.
    await postMessage({ ...ctx, source: "user" }, "dm", {
      body: "from the app",
      metadata: { author_agent_id: AGENT },
    });

    expect(has(capturedMetadata(), "author_agent_id")).toBe(false);
  });
});

/**
 * ⚠ `to_user_notify` is stripped unconditionally and has NO reader at all — the
 * failure mode is a future edit reading the `delete` as dead code. Keep it: the
 * name is documented as server-owned, so the day something does read it, it must
 * not already be full of values a caller chose.
 */
describe("SECURITY: the documented-but-unbuilt `to_user_notify` is stripped", () => {
  it("SECURITY: a caller-supplied metadata.to_user_notify never reaches the row", async () => {
    const msg = await postMessage(ctx, "dm", {
      body: "please tell the human, not the agent",
      metadata: { to_user_notify: PEER, keep: 1 },
    });

    const meta = capturedMetadata();
    expect(has(meta, "to_user_notify")).toBe(false);
    expect(has(msg.metadata as Record<string, unknown>, "to_user_notify")).toBe(
      false
    );
    // Scalpel, not a wipe.
    expect(meta.keep).toBe(1);
  });

  it("SECURITY: the strip is type-blind and source-blind", async () => {
    for (const value of [PEER, true, "", 0, null, [PEER], { id: PEER }]) {
      for (const source of ["agent", "user"] as const) {
        vi.clearAllMocks();
        vi.mocked(repoMessages.insertMessage).mockImplementation(async (row) =>
          insertedRow(row)
        );
        await postMessage({ ...ctx, source }, "dm", {
          body: "x",
          metadata: { to_user_notify: value },
        });
        expect(
          has(capturedMetadata(), "to_user_notify"),
          `survived ${JSON.stringify(value)} on source=${source}`
        ).toBe(false);
      }
    }
  });

  it("SECURITY: nothing re-stamps it either — a clean post grows no such key", async () => {
    await postMessage(
      { ...ctx, runtime: "desktop-session", appVersion: "1.9.0" },
      "dm",
      { body: "plain reply", toUserId: PEER }
    );

    const meta = capturedMetadata();
    expect(has(meta, "to_user_notify")).toBe(false);
    expect(meta.to_user_id).toBe(PEER);
  });
});
