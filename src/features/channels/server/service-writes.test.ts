/**
 * Unit tests for the channels write service — `postMessage` metadata handling.
 * The repository is mocked (no Supabase); `service-shared` / `service-reads`
 * run for real against the mocked repo.
 *
 * Focus: the reserved-key strip is a SECURITY boundary. `to_user_id` and
 * `summary` inside caller-supplied `metadata` must be dropped and are settable
 * ONLY via the validated top-level `toUserId` / `summary` fields — a raw
 * metadata copy would bypass both the addressee-membership check and the
 * schema's summary length cap (consent-prompt spoofing on non-members).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./repository");

import * as repo from "./repository";
import { postMessage } from "./service-writes";
import {
  ChannelAddresseeNotMemberError,
  ChannelForbiddenError,
} from "./errors";
import type { ChannelContext } from "./service-shared";
import type {
  ChannelMemberRow,
  ChannelMessageRow,
  ChannelRow,
} from "./dto";

const WS = "ws-1";
const USER = "user-1";
const ADDRESSEE = "550e8400-e29b-41d4-a716-446655440000";

const ctx: ChannelContext = {
  workspaceId: WS,
  userId: USER,
  source: "user",
  role: "member",
};

const agentCtx: ChannelContext = { ...ctx, source: "agent" };

function channelRow(overrides: Partial<ChannelRow> = {}): ChannelRow {
  return {
    id: "chan-1",
    workspace_id: WS,
    created_by: USER,
    slug: "general",
    name: "General",
    topic: "",
    visibility: "private",
    archived_at: null,
    deleted_at: null,
    created_at: "2026-07-20T00:00:00Z",
    updated_at: "2026-07-20T00:00:00Z",
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
    added_by: USER,
    joined_at: "2026-07-20T00:00:00Z",
  };
}

/** Echo the insert back as a stored row so `hydrateOne` can map it. */
function insertedRow(row: Parameters<typeof repo.insertMessage>[0]): ChannelMessageRow {
  return {
    id: "msg-1",
    seq: 1,
    channel_id: row.channel_id,
    workspace_id: row.workspace_id,
    author_user_id: row.author_user_id,
    author_kind: row.author_kind,
    kind: row.kind,
    body: row.body,
    metadata: row.metadata,
    client_msg_id: row.client_msg_id,
    created_at: "2026-07-20T00:00:00Z",
  };
}

/** Membership resolver: `USER` is a member; `ADDRESSEE` membership is per-test. */
function wireMembership(addresseeIsMember: boolean) {
  vi.mocked(repo.findMembership).mockImplementation(async (_channelId, userId) => {
    if (userId === USER) return memberRow(USER, "owner");
    if (userId === ADDRESSEE && addresseeIsMember) return memberRow(ADDRESSEE);
    return null;
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(repo.findChannelBySlug).mockResolvedValue(channelRow());
  vi.mocked(repo.findMessageByClientId).mockResolvedValue(null);
  vi.mocked(repo.touchChannel).mockResolvedValue(undefined);
  vi.mocked(repo.fetchProfiles).mockResolvedValue([]);
  vi.mocked(repo.insertMessage).mockImplementation(async (row) => insertedRow(row));
  wireMembership(true);
});

/** The metadata object handed to `repo.insertMessage`. */
function capturedMetadata(): Record<string, unknown> {
  const call = vi.mocked(repo.insertMessage).mock.calls[0];
  return call[0].metadata;
}

describe("postMessage — reserved metadata keys", () => {
  it("strips caller `to_user_id`/`summary` from metadata, preserves other keys", async () => {
    await postMessage(ctx, "general", {
      body: "hello",
      // No validated top-level toUserId/summary → nothing re-added.
      metadata: { to_user_id: "evil", summary: "spoofed prompt", foo: "bar" },
    });

    const meta = capturedMetadata();
    expect(Object.prototype.hasOwnProperty.call(meta, "to_user_id")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(meta, "summary")).toBe(false);
    expect(meta.foo).toBe("bar");
  });

  it("folds validated top-level toUserId/summary in, overriding metadata copies", async () => {
    await postMessage(ctx, "general", {
      body: "hello",
      toUserId: ADDRESSEE,
      summary: "real intent",
      metadata: { to_user_id: "evil", summary: "spoofed", keep: 1 },
    });

    const meta = capturedMetadata();
    // Reserved keys reflect ONLY the validated top-level values.
    expect(meta.to_user_id).toBe(ADDRESSEE);
    expect(meta.summary).toBe("real intent");
    expect(meta.keep).toBe(1);
  });

  it("SECURITY: a metadata-only to_user_id at a NON-member neither throws nor is stored (anti-spoof)", async () => {
    // A raw metadata `to_user_id` must never reach the stored row: it bypasses
    // the addressee-membership check (which only runs on the top-level field),
    // so a message would falsely read as "addressed" to a listener. The strip
    // means the stored message carries no `to_user_id` at all — no spoof.
    wireMembership(false); // ADDRESSEE is NOT a channel member

    const msg = await postMessage(ctx, "general", {
      body: "hello",
      metadata: { to_user_id: ADDRESSEE, other: "x" },
    });

    // No ChannelAddresseeNotMemberError — the top-level addressee is absent.
    expect(repo.insertMessage).toHaveBeenCalledTimes(1);
    const meta = capturedMetadata();
    expect(Object.prototype.hasOwnProperty.call(meta, "to_user_id")).toBe(false);
    expect(meta.other).toBe("x");
    expect(msg.metadata.to_user_id).toBeUndefined();
  });

  it("adversarial JSON `__proto__` does not pollute or reintroduce a reserved key", async () => {
    // Simulate a JSON-origin payload where `__proto__` is an OWN key.
    const metadata = JSON.parse(
      '{"__proto__":{"polluted":true},"to_user_id":"evil","keep":1}'
    ) as Record<string, unknown>;

    await postMessage(ctx, "general", { body: "hello", metadata });

    const meta = capturedMetadata();
    expect(Object.prototype.hasOwnProperty.call(meta, "to_user_id")).toBe(false);
    expect(meta.keep).toBe(1);
    // No global prototype pollution leaked out of the strip/spread.
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe("postMessage — addressing + author derivation", () => {
  it("rejects a top-level toUserId that is not a channel member (400)", async () => {
    wireMembership(false);
    await expect(
      postMessage(ctx, "general", { body: "hi", toUserId: ADDRESSEE })
    ).rejects.toBeInstanceOf(ChannelAddresseeNotMemberError);
    expect(repo.insertMessage).not.toHaveBeenCalled();
  });

  it("refuses a non-member posting to a PUBLIC channel (forbidden, not not-found)", async () => {
    // A public channel is readable to any workspace member but only members may
    // post. (A PRIVATE channel non-member gets ChannelNotFoundError instead —
    // its existence must not leak — so the forbidden-post branch needs a public
    // channel with a non-member caller.)
    vi.mocked(repo.findChannelBySlug).mockResolvedValue(
      channelRow({ visibility: "public" })
    );
    vi.mocked(repo.findMembership).mockResolvedValue(null); // caller not a member

    await expect(
      postMessage(ctx, "general", { body: "hi" })
    ).rejects.toBeInstanceOf(ChannelForbiddenError);
    expect(repo.insertMessage).not.toHaveBeenCalled();
  });

  it("derives author_kind='agent' for an agent-source ctx, 'user' otherwise", async () => {
    await postMessage(agentCtx, "general", { body: "hi" });
    expect(vi.mocked(repo.insertMessage).mock.calls[0][0].author_kind).toBe("agent");

    vi.mocked(repo.insertMessage).mockClear();
    await postMessage(ctx, "general", { body: "hi" });
    expect(vi.mocked(repo.insertMessage).mock.calls[0][0].author_kind).toBe("user");
  });

  it("an explicit authorKind wins over the ctx-derived default", async () => {
    // A cookie-session desktop app posts an agent task result over a user ctx.
    await postMessage(ctx, "general", { body: "done", authorKind: "agent" });
    expect(vi.mocked(repo.insertMessage).mock.calls[0][0].author_kind).toBe("agent");
  });
});
