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
vi.mock("./repository-messages");
vi.mock("./repository-tasks");

import * as repo from "./repository";
import * as repoMessages from "./repository-messages";
import * as repoTasks from "./repository-tasks";
import { postMessage } from "./service-writes";
import {
  ChannelAddresseeNotMemberError,
  ChannelForbiddenError,
  ChannelTaskNotInChannelError,
  TaskForbiddenError,
} from "./errors";
import type { ChannelContext } from "./service-shared";
import type { ChannelMemberRow, ChannelMessageRow, ChannelRow } from "./dto";

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
    is_direct: false,
    direct_key: null,
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
function insertedRow(row: Parameters<typeof repoMessages.insertMessage>[0]): ChannelMessageRow {
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
  vi.mocked(repoMessages.findMessageByClientId).mockResolvedValue(null);
  vi.mocked(repo.touchChannel).mockResolvedValue(undefined);
  vi.mocked(repo.fetchProfiles).mockResolvedValue([]);
  vi.mocked(repoMessages.insertMessage).mockImplementation(async (row) => insertedRow(row));
  wireMembership(true);
});

/** The metadata object handed to `repoMessages.insertMessage`. */
function capturedMetadata(): Record<string, unknown> {
  const call = vi.mocked(repoMessages.insertMessage).mock.calls[0];
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
    expect(repoMessages.insertMessage).toHaveBeenCalledTimes(1);
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

describe("postMessage — task metadata stamping (v15, Q4)", () => {
  const TASK_ID = "660e8400-e29b-41d4-a716-446655440111";

  function taskRowFor(overrides: Record<string, unknown> = {}) {
    return {
      id: TASK_ID,
      channel_id: "chan-1",
      workspace_id: WS,
      title: "Real title",
      status: "open",
      outcome: null,
      mode: "autonomous",
      // The poster is the thread's creator — the legitimate case. A caller who
      // is neither creator nor target is refused outright (see the B3 test).
      created_by: USER,
      target_user_id: null,
      created_at: "2026-07-20T00:00:00Z",
      updated_at: "2026-07-20T00:00:00Z",
      closed_at: null,
      ...overrides,
    } as Awaited<ReturnType<typeof repoTasks.findTaskByChannelAndId>>;
  }

  it("strips caller taskMode/taskCreatedBy/taskTitle and stamps from the resolved task", async () => {
    vi.mocked(repoTasks.findTaskByChannelAndId).mockResolvedValue(taskRowFor());

    await postMessage(ctx, "general", {
      body: "reply",
      metadata: {
        taskId: TASK_ID,
        taskMode: "interactive",
        taskCreatedBy: "evil",
        taskTitle: "spoofed",
      },
    });

    const meta = capturedMetadata();
    // taskId itself stays caller-settable (a responder replies within a task).
    expect(meta.taskId).toBe(TASK_ID);
    // Server stamp wins over the caller's spoofed reserved keys.
    expect(meta.taskMode).toBe("autonomous");
    expect(meta.taskCreatedBy).toBe(USER);
    expect(meta.taskTitle).toBe("Real title");
    expect(repoTasks.findTaskByChannelAndId).toHaveBeenCalledWith("chan-1", TASK_ID);
  });

  it("SECURITY: a UUID taskId that resolves to no task in the channel is rejected (400), not silently un-threaded", async () => {
    // v1.7 server-validated threading: a bogus first-class id can no longer
    // fabricate a threaded group — the post is rejected outright.
    vi.mocked(repoTasks.findTaskByChannelAndId).mockResolvedValue(null);

    await expect(
      postMessage(ctx, "general", {
        body: "reply",
        metadata: { taskId: TASK_ID, taskMode: "interactive" },
      })
    ).rejects.toBeInstanceOf(ChannelTaskNotInChannelError);

    expect(repoTasks.findTaskByChannelAndId).toHaveBeenCalledWith("chan-1", TASK_ID);
    // Rejected before insert — nothing lands.
    expect(repoMessages.insertMessage).not.toHaveBeenCalled();
  });

  it("a non-UUID taskId never hits the DB and stamps nothing (old task-<uuid>-<seq> ids)", async () => {
    await postMessage(ctx, "general", {
      body: "reply",
      metadata: { taskId: "task-chan-1-7", taskMode: "interactive" },
    });

    expect(repoTasks.findTaskByChannelAndId).not.toHaveBeenCalled();
    const meta = capturedMetadata();
    expect(meta.taskId).toBe("task-chan-1-7");
    expect(Object.prototype.hasOwnProperty.call(meta, "taskMode")).toBe(false);
  });

  it("SECURITY (B3): a member who is neither creator nor target cannot post into the thread", async () => {
    // Channel membership is not thread membership: in a 3+ member channel every
    // member can read every thread id, and a stamped taskId is what lands the
    // message inside that thread's card and routes it to the responder's
    // session window. Refused outright rather than silently un-threaded.
    vi.mocked(repoTasks.findTaskByChannelAndId).mockResolvedValue(
      taskRowFor({ created_by: "creator-x", target_user_id: "responder-y" })
    );

    await expect(
      postMessage(ctx, "general", {
        body: "landing in someone else's thread",
        metadata: { taskId: TASK_ID },
      })
    ).rejects.toBeInstanceOf(TaskForbiddenError);

    expect(repoMessages.insertMessage).not.toHaveBeenCalled();
  });

  it("allows the thread's TARGET to post into it (the responder's own replies)", async () => {
    vi.mocked(repoTasks.findTaskByChannelAndId).mockResolvedValue(
      taskRowFor({ created_by: "creator-x", target_user_id: USER })
    );

    await postMessage(ctx, "general", {
      body: "here is the answer",
      metadata: { taskId: TASK_ID },
    });

    expect(capturedMetadata().taskId).toBe(TASK_ID);
  });

  it("stamps taskTarget from the task's target_user_id, stripping the caller copy", async () => {
    vi.mocked(repoTasks.findTaskByChannelAndId).mockResolvedValue(
      taskRowFor({ target_user_id: "responder-y" })
    );

    await postMessage(ctx, "general", {
      body: "here is the answer",
      metadata: { taskId: TASK_ID, taskTarget: "evil" },
    });

    const meta = capturedMetadata();
    // The server stamp (the real responder) wins over the caller's spoof — this
    // is what binds the desktop's task-reply suppression to the true responder.
    expect(meta.taskTarget).toBe("responder-y");
  });

  it("a null-target task stamps no taskTarget and strips the caller copy", async () => {
    vi.mocked(repoTasks.findTaskByChannelAndId).mockResolvedValue(
      taskRowFor({ target_user_id: null })
    );

    await postMessage(ctx, "general", {
      body: "reply",
      metadata: { taskId: TASK_ID, taskTarget: "evil" },
    });

    const meta = capturedMetadata();
    expect(Object.prototype.hasOwnProperty.call(meta, "taskTarget")).toBe(false);
  });
});

describe("postMessage — addressing + author derivation", () => {
  it("rejects a top-level toUserId that is not a channel member (400)", async () => {
    wireMembership(false);
    await expect(
      postMessage(ctx, "general", { body: "hi", toUserId: ADDRESSEE })
    ).rejects.toBeInstanceOf(ChannelAddresseeNotMemberError);
    expect(repoMessages.insertMessage).not.toHaveBeenCalled();
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
    expect(repoMessages.insertMessage).not.toHaveBeenCalled();
  });

  it("derives author_kind='agent' for an agent-source ctx, 'user' otherwise", async () => {
    await postMessage(agentCtx, "general", { body: "hi" });
    expect(vi.mocked(repoMessages.insertMessage).mock.calls[0][0].author_kind).toBe("agent");

    vi.mocked(repoMessages.insertMessage).mockClear();
    await postMessage(ctx, "general", { body: "hi" });
    expect(vi.mocked(repoMessages.insertMessage).mock.calls[0][0].author_kind).toBe("user");
  });

  it("an explicit authorKind wins over the ctx-derived default", async () => {
    // A cookie-session desktop app posts an agent thread result over a user ctx.
    await postMessage(ctx, "general", { body: "done", authorKind: "agent" });
    expect(vi.mocked(repoMessages.insertMessage).mock.calls[0][0].author_kind).toBe("agent");
  });

  it("an explicit authorKind wins in BOTH directions (it is a claim, not a derivation)", async () => {
    // The mirror of the case above. ENGINEERING.md §8 documented `authorKind` as
    // DERIVED from the credential until 2026-07-30; it never was, and the
    // desktop peer-post path depends on the caller's value winning. Pinning both
    // directions stops a future "harden this" edit from turning the `??` into a
    // hard derive and silently breaking that path (F-082).
    await postMessage(agentCtx, "general", { body: "hi", authorKind: "user" });
    expect(vi.mocked(repoMessages.insertMessage).mock.calls[0][0].author_kind).toBe("user");
  });

  it("never lets the caller move authorship off ctx.userId", async () => {
    // Only the KIND label is assertable. The identity is not: `author_user_id`
    // is always the acting user, so an `agent` claim can never impersonate a
    // different member.
    await postMessage(ctx, "general", { body: "hi", authorKind: "agent" });
    const row = vi.mocked(repoMessages.insertMessage).mock.calls[0][0];
    expect(row.author_user_id).toBe(ctx.userId);
  });
});
