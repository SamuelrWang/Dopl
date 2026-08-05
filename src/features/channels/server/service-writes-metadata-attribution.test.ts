/**
 * F-145 — THE AGENT-ATTRIBUTION STRIP, which was the only defence and had no
 * test at all.
 *
 * `resolvePostMetadata` deletes three keys from caller metadata and never
 * re-stamps any of them:
 *
 *   delete metadata.to_agent_id;
 *   delete metadata.to_agent_ids;
 *   delete metadata.author_agent_id;
 *
 * MUTATION-PROVEN GAP. Removing each of those three lines individually left all
 * 2109 root tests green. Every sibling reserved key — `intent`, `handoff`,
 * `to_user_id`, `session_id`, `summary`, `runtime`, `appVersion` — has a firing
 * SECURITY test; these three had theirs inside
 * `service-writes-metadata-agents.test.ts`, which was DELETED whole with the
 * named-agent feature in rollback §1. The feature went; the key did not, and
 * neither did the reason it is stripped.
 *
 * WHY IT STILL MATTERS WITH THE FEATURE GONE — and this is the part the deletion
 * missed. The WRITE path for named agents is gone; the READ path is deliberately
 * alive, because stored rows still carry `author_agent_id` and the transcript
 * still has to render them (`lib/agent-display.ts`, `channel-transcript.tsx`:
 * "quartz · Ada's agent"). So the key is now a display credential with a live
 * reader and NO legitimate writer — which makes the strip the entire boundary.
 * A caller who could set it on a NEW post would attribute their own words to
 * somebody's retired agent, on the other member's screen, with the server's
 * own byline. `to_agent_id` / `to_agent_ids` are the same shape one lane over:
 * a forged addressee on a stored row.
 *
 * A KEY WITH NO WRITER IS THE EASIEST THING IN A CODEBASE TO DELETE BY MISTAKE
 * — it reads as dead code, and the strip does not fail loudly when it goes. So
 * this file drives the real `postMessage` and asserts the ABSENCE, per key,
 * across every shape a caller can send one in. Harness copied from
 * `service-writes-metadata-session.test.ts`, whose key is stripped on identical
 * terms.
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
  vi.mocked(repoTasks.listTasksByChannel).mockResolvedValue([]);
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
      // The STORED message, not just the insert argument: the row the peer
      // eventually renders is the thing that must not carry it.
      expect(has(msg.metadata as Record<string, unknown>, key)).toBe(false);
      // Only the reserved key is taken — unrelated caller metadata survives, so
      // the strip is a scalpel and a broad wipe would not pass this.
      expect(meta.keep).toBe(1);
    });
  }

  it("SECURITY: all three at once, on one post", async () => {
    // The realistic forgery is not one key: an old client (or a model that read
    // stale docs) sends the whole named-agent envelope together.
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
    // A `delete` is type-blind and must stay that way: a guard that only
    // stripped "valid-looking" ids would leave the shapes a renderer coerces.
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
    // The other half of "stripped and NEVER re-stamped". A future stamp added
    // beside `runtime` / `session_id` would make the strip pointless, and this
    // is what would notice.
    await postMessage(
      { ...ctx, runtime: "desktop-session", appVersion: "1.9.0" },
      "dm",
      { body: "plain reply" }
    );

    const meta = capturedMetadata();
    for (const [key] of AGENT_KEYS) expect(has(meta, key)).toBe(false);
    // …and the stamps that ARE legitimate still landed, so this is proving an
    // absence in a metadata object that is otherwise populated.
    expect(meta.runtime).toBe("desktop-session");
    expect(meta.to_user_id).toBe(PEER);
  });

  it("SECURITY: a USER-credentialed caller gets the same strip as an agent one", async () => {
    // The web and the desktop listener post on the operator's cookies
    // (`source: "user"`). Attribution is not a scope question — nobody may
    // author as somebody's agent — so the strip must not be source-conditional.
    await postMessage({ ...ctx, source: "user" }, "dm", {
      body: "from the app",
      metadata: { author_agent_id: AGENT },
    });

    expect(has(capturedMetadata(), "author_agent_id")).toBe(false);
  });
});
