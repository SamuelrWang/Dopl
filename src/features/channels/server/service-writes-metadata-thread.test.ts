/**
 * THREAD PARTICIPATION on a post — both id shapes, and the calm-terminal flags
 * that ride on the same decision.
 *
 * WHY IT MATTERS (F-083 bullet 3 / audit Q10). A stamped `metadata.taskId` is
 * what puts a message inside a thread's card and routes it to the responder's
 * session window, and every channel member can SEE every thread id (reads are
 * channel-transparent by design). The first-class UUID shape has been gated
 * since v2.9, but the legacy `task-{channelId}-{seq}` shape — the one the
 * installed desktop still posts its lifecycle events with — skipped the gate
 * entirely and was stored verbatim: a third member could stamp another pair's
 * exchange and have their message land in that pair's card, or flip its
 * outcome with a lifecycle kind.
 *
 * The decision this file pins: VALIDATE VIA THE OPENER, STRIP ON FAIL, NEVER
 * 403. A legacy id is checked against its opening request's
 * {author, to_user_id} pair; a caller outside that pair loses the TAG, not the
 * message. The strip (rather than the UUID branch's 403) is wire compat —
 * desktop 1.7.16 is in the field posting these ids, some against pre-v1.6
 * openers that carry no addressee at all.
 *
 * Kept out of `service-writes-metadata.test.ts` only because that file is at
 * the §2 size cap; the harness below is the same one, trimmed to this fold.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./repository");
vi.mock("./repository-messages");
vi.mock("./repository-tasks");
vi.mock("./repository-participants");

import * as repo from "./repository";
import * as repoMessages from "./repository-messages";
import * as repoTasks from "./repository-tasks";
import * as repoParticipants from "./repository-participants";
import { TaskForbiddenError } from "./errors";
import { postMessage } from "./service-writes";
import type {
  ChannelMemberRow,
  ChannelMessageRow,
  ChannelRow,
  ChannelTaskRow,
} from "./dto";
import type { ChannelContext } from "./service-shared";

const WS = "ws-1";
const USER = "11111111-e29b-41d4-a716-446655440000";
const PEER = "22222222-e29b-41d4-a716-446655440000";
const THIRD = "33333333-e29b-41d4-a716-446655440000";
const TASK_ID = "44444444-e29b-41d4-a716-446655440000";

/** A legacy `task-{channelId}-{seq}` id — the shape the desktop still posts. */
const LEGACY_ID = "task-chan-1-7";

const ctx: ChannelContext = {
  workspaceId: WS,
  userId: USER,
  source: "agent",
  role: "member",
};

function channelRow(overrides: Partial<ChannelRow> = {}): ChannelRow {
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
    created_at: "2026-07-31T00:00:00Z",
    updated_at: "2026-07-31T00:00:00Z",
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
    joined_at: "2026-07-31T00:00:00Z",
  };
}

function taskRow(overrides: Partial<ChannelTaskRow> = {}): ChannelTaskRow {
  return {
    id: TASK_ID,
    channel_id: "chan-1",
    workspace_id: WS,
    title: "Wire the listener",
    status: "open",
    outcome: null,
    mode: "interactive",
    created_by: PEER,
    target_user_id: USER,
    created_at: "2026-07-31T00:00:00Z",
    updated_at: "2026-07-31T00:00:00Z",
    closed_at: null,
    outcome_summary: null,
    ...overrides,
  };
}

/** The legacy exchange's opening request at seq 7: PEER asked USER. */
function opener(overrides: Partial<ChannelMessageRow> = {}): ChannelMessageRow {
  return {
    id: "msg-open",
    seq: 7,
    channel_id: "chan-1",
    workspace_id: WS,
    author_user_id: PEER,
    author_kind: "user",
    kind: "message",
    body: "please do X",
    metadata: { to_user_id: USER },
    client_msg_id: null,
    created_at: "2026-07-31T00:00:00Z",
    ...overrides,
  };
}

function insertedRow(
  row: Parameters<typeof repoMessages.insertMessage>[0]
): ChannelMessageRow {
  return {
    id: "msg-1",
    seq: 98,
    channel_id: row.channel_id,
    workspace_id: row.workspace_id,
    author_user_id: row.author_user_id,
    author_kind: row.author_kind,
    kind: row.kind,
    body: row.body,
    metadata: row.metadata,
    client_msg_id: row.client_msg_id,
    created_at: "2026-07-31T00:00:00Z",
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
  // Multiplayer: every thread-tagged post runs the participant-aware write
  // gate, and every thread read hydrates a participant set. No participants =
  // the pair gate, which is what these suites are about.
  vi.mocked(repoParticipants.listParticipantsByTask).mockResolvedValue([]);
  vi.mocked(repoParticipants.listParticipantsByTasks).mockResolvedValue(new Map());
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
  vi.mocked(repoMessages.findMessageBySeq).mockResolvedValue(opener());
});

describe("postMessage — legacy thread tag, kept for the exchange's own pair", () => {
  it("keeps the tag for the ADDRESSEE of the opening request (the responder's reply)", async () => {
    await postMessage(ctx, "dm", { body: "on it", metadata: { taskId: LEGACY_ID } });

    expect(capturedMetadata().taskId).toBe(LEGACY_ID);
    expect(repoMessages.findMessageBySeq).toHaveBeenCalledWith("chan-1", 7);
    // No task row exists for a legacy id, so none of the four server-stamped
    // task keys appear — a legacy card renders titleless, and that is the tell.
    expect(has(capturedMetadata(), "taskTitle")).toBe(false);
  });

  it("keeps the tag for the AUTHOR of the opening request (the requester's follow-up)", async () => {
    vi.mocked(repoMessages.findMessageBySeq).mockResolvedValue(
      opener({ author_user_id: USER, metadata: { to_user_id: THIRD } })
    );

    await postMessage(ctx, "dm", {
      body: "any progress?",
      metadata: { taskId: LEGACY_ID },
    });

    expect(capturedMetadata().taskId).toBe(LEGACY_ID);
  });

  it("keeps it on a LIFECYCLE post — the compat case the strip exists to protect", async () => {
    // Installed desktop 1.7.16 posts legacy ids for task_started/finished/failed.
    // These must keep threading, which is why the gate strips instead of 403ing.
    await postMessage(ctx, "dm", {
      body: "Session ended",
      kind: "task_finished",
      metadata: { taskId: LEGACY_ID },
    });

    expect(capturedMetadata().taskId).toBe(LEGACY_ID);
    expect(repoMessages.insertMessage).toHaveBeenCalledTimes(1);
  });
});

describe("postMessage — legacy thread tag, STRIPPED for everyone else (Q10)", () => {
  /** Every strip case must still deliver the message, untagged. */
  async function expectStripped(taskId: string, body = "landing elsewhere") {
    // Usage data only — the harness implementations survive (mockClear, not
    // mockReset), so a case may assert over several ids in a row.
    vi.mocked(repoMessages.insertMessage).mockClear();

    await postMessage(ctx, "dm", { body, metadata: { taskId } });

    const meta = capturedMetadata();
    expect(has(meta, "taskId")).toBe(false);
    // The post is never blocked — it stays visible and attributable.
    expect(repoMessages.insertMessage).toHaveBeenCalledTimes(1);
    return meta;
  }

  it("SECURITY: a third member cannot stamp another pair's exchange", async () => {
    // The forgery: C posts `kind:"task_failed"` carrying A-and-B's legacy id and
    // the row lands inside their card / flips their session status.
    vi.mocked(repoMessages.findMessageBySeq).mockResolvedValue(
      opener({ author_user_id: PEER, metadata: { to_user_id: THIRD } })
    );

    await expectStripped(LEGACY_ID, "not my thread");
  });

  it("strips an id that names ANOTHER channel, without touching the DB", async () => {
    await expectStripped("task-chan-2-7");
    await expectStripped(`task-${TASK_ID}-7`);

    // Prefix mismatch is decided from the id alone — a foreign id can never be
    // used to probe this channel's seq space.
    expect(repoMessages.findMessageBySeq).not.toHaveBeenCalled();
  });

  it("strips a malformed seq and a tag that is not a legacy id at all", async () => {
    for (const bad of [
      "task-chan-1-abc",
      "task-chan-1-",
      "task-chan-1-0", // seqs start at 1
      "task-chan-1--3",
      "task-chan-1-7.5",
      "task-chan-1-99999999999999999999", // past integer precision
      "eng-thread", // a plain typo used to report "THREADED"
    ]) {
      await expectStripped(bad);
    }
    // None of them was worth a read: the shape decides.
    expect(repoMessages.findMessageBySeq).not.toHaveBeenCalled();
  });

  it("SECURITY: fails closed when the opener is missing", async () => {
    vi.mocked(repoMessages.findMessageBySeq).mockResolvedValue(null);

    await expectStripped(LEGACY_ID);
  });

  it("SECURITY: fails closed when the opener is UNADDRESSED and someone else wrote it", async () => {
    // A pre-v1.6 row: no `to_user_id`, so the only known party is its author.
    vi.mocked(repoMessages.findMessageBySeq).mockResolvedValue(
      opener({ author_user_id: PEER, metadata: {} })
    );

    await expectStripped(LEGACY_ID);
  });

  it("strips a blank / non-string tag rather than storing it", async () => {
    await postMessage(ctx, "dm", { body: "hi", metadata: { taskId: "   " } });

    expect(has(capturedMetadata(), "taskId")).toBe(false);
    expect(repoMessages.findMessageBySeq).not.toHaveBeenCalled();
  });

  it("a stripped tag does not disturb the rest of the fold", async () => {
    vi.mocked(repoMessages.findMessageBySeq).mockResolvedValue(
      opener({ author_user_id: PEER, metadata: { to_user_id: THIRD } })
    );

    const meta = await expectStripped(LEGACY_ID);

    // Auto-addressing, the anti-spoof strip and unrelated caller keys all hold.
    expect(meta.to_user_id).toBe(PEER);
    expect(has(meta, "taskMode")).toBe(false);
  });
});

describe("postMessage — first-class (UUID) thread tag is unchanged", () => {
  it("SECURITY: still REFUSES a non-participant outright (403, not a strip)", async () => {
    vi.mocked(repoTasks.findTaskByChannelAndId).mockResolvedValue(
      taskRow({ created_by: PEER, target_user_id: THIRD })
    );

    await expect(
      postMessage(ctx, "dm", {
        body: "landing in someone else's thread",
        metadata: { taskId: TASK_ID },
      })
    ).rejects.toBeInstanceOf(TaskForbiddenError);

    expect(repoMessages.insertMessage).not.toHaveBeenCalled();
    // The legacy resolver is never consulted for a UUID.
    expect(repoMessages.findMessageBySeq).not.toHaveBeenCalled();
  });

  it("keeps threading (and the stamped task keys) for a participant", async () => {
    vi.mocked(repoTasks.findTaskByChannelAndId).mockResolvedValue(taskRow());

    await postMessage(ctx, "dm", { body: "here it is", metadata: { taskId: TASK_ID } });

    const meta = capturedMetadata();
    expect(meta.taskId).toBe(TASK_ID);
    expect(meta.taskTitle).toBe("Wire the listener");
  });
});

/**
 * The calm-terminal flags (declined/dropped/interrupted/capped/ended) decide
 * whether the OTHER side's card reads as a calm, operator-chosen ending or a
 * red failure. They are reserved keys, and since the legacy gate closed they
 * ride on exactly one question: did the thread tag survive?
 */
describe("postMessage — calm-terminal flags follow the tag decision", () => {
  it("stamps the flag for a participant of a LEGACY exchange (the decline echo)", async () => {
    await postMessage(ctx, "dm", {
      body: "Request declined",
      kind: "task_failed",
      metadata: { taskId: LEGACY_ID, declined: true },
    });

    const meta = capturedMetadata();
    expect(meta.declined).toBe(true);
    expect(meta.taskId).toBe(LEGACY_ID);
    // ONE resolver, ONE read: the tag gate and the flags share the lookup.
    expect(repoMessages.findMessageBySeq).toHaveBeenCalledTimes(1);
  });

  it("stamps the flag for the AUTHOR of the legacy opening request", async () => {
    vi.mocked(repoMessages.findMessageBySeq).mockResolvedValue(
      opener({ author_user_id: USER, metadata: { to_user_id: THIRD } })
    );

    await postMessage(ctx, "dm", {
      body: "Session ended",
      kind: "task_failed",
      metadata: { taskId: LEGACY_ID, ended: true },
    });

    expect(capturedMetadata().ended).toBe(true);
  });

  it("SECURITY: strips the flags WITH the tag when the exchange is two OTHER people's", async () => {
    // The spoof: a third member stamps someone else's exchange id with
    // `declined: true`, and their card renders "This request was declined."
    // for work that was never declined. Now the tag goes too, so there is
    // nothing left for the flag to attach to.
    vi.mocked(repoMessages.findMessageBySeq).mockResolvedValue(
      opener({ author_user_id: PEER, metadata: { to_user_id: THIRD } })
    );

    await postMessage(ctx, "dm", {
      body: "Request declined",
      kind: "task_failed",
      metadata: { taskId: LEGACY_ID, declined: true, dropped: true },
    });

    const meta = capturedMetadata();
    expect(has(meta, "declined")).toBe(false);
    expect(has(meta, "dropped")).toBe(false);
    expect(has(meta, "taskId")).toBe(false);
    // Stripped, but the message itself still posts (visible, attributable).
    expect(repoMessages.insertMessage).toHaveBeenCalledTimes(1);
  });

  it("SECURITY: fails closed when the legacy opener cannot be resolved", async () => {
    vi.mocked(repoMessages.findMessageBySeq).mockResolvedValue(null);

    await postMessage(ctx, "dm", {
      body: "Request interrupted",
      kind: "task_failed",
      metadata: { taskId: LEGACY_ID, interrupted: true },
    });

    const meta = capturedMetadata();
    expect(has(meta, "interrupted")).toBe(false);
    expect(has(meta, "taskId")).toBe(false);
  });

  it("stamps the flag on a FIRST-CLASS thread the poster participates in", async () => {
    vi.mocked(repoTasks.findTaskByChannelAndId).mockResolvedValue(taskRow());

    await postMessage(ctx, "dm", {
      body: "Turn limit reached",
      kind: "task_failed",
      metadata: { taskId: TASK_ID, capped: true },
    });

    const meta = capturedMetadata();
    expect(meta.capped).toBe(true);
    expect(meta.taskTitle).toBe("Wire the listener");
    // A first-class id the poster does NOT participate in never gets this far —
    // the post is refused above.
    expect(repoMessages.findMessageBySeq).not.toHaveBeenCalled();
  });

  it("strips a truthy-but-not-true flag even from a participant", async () => {
    // The renderers read `=== true`; normalizing here keeps the stored wire
    // clean instead of relying on every reader staying strict.
    await postMessage(ctx, "dm", {
      body: "Crashed",
      kind: "task_failed",
      metadata: { taskId: LEGACY_ID, capped: "true", ended: 1 },
    });

    const meta = capturedMetadata();
    expect(has(meta, "capped")).toBe(false);
    expect(has(meta, "ended")).toBe(false);
    expect(meta.taskId).toBe(LEGACY_ID);
  });

  it("strips flags on a post with no thread id at all", async () => {
    await postMessage(ctx, "dm", {
      body: "not a real outcome",
      kind: "task_failed",
      metadata: { declined: true },
    });

    expect(has(capturedMetadata(), "declined")).toBe(false);
    expect(repoMessages.findMessageBySeq).not.toHaveBeenCalled();
  });
});
