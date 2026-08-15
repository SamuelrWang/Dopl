/**
 * Lifecycle kinds are not an agent's to post — the AUTHORITATIVE half, holding
 * for anything posting straight at `/api/channels/[id]/messages` with a device
 * token. (`channel-ops-write.ts` refuses earlier for MCP callers.)
 *
 * ⚠ THE SEAM IS THE CREDENTIAL, not who the message says wrote it. Too wide and
 * the desktop runtime's own echoes stop (`main/session-window.js` posts on
 * Electron's Supabase cookies, so `source:"user"`) or the close route's echo
 * stops; too narrow and an agent's answer posted as `task_finished` renders
 * nowhere (`lib/group-thread.ts` folds terminal markers into `draft.endEvent`,
 * never `draft.entries`). Asserted in both directions.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./repository");
vi.mock("./repository-messages");
vi.mock("./repository-tasks");

import * as repo from "./repository";
import * as repoMessages from "./repository-messages";
import * as repoTasks from "./repository-tasks";
import { postMessage } from "./service-writes";
import { closeTask } from "./service-tasks-lifecycle";
import { proposeTaskClose } from "./service-tasks-propose";
import {
  ChannelLifecycleKindForbiddenError,
  TaskForbiddenError,
  ThreadCloseIsHumanOnlyError,
} from "./errors";
import type { ChannelContext } from "./service-shared";
import type { ChannelMemberRow, ChannelMessageRow, ChannelRow, ChannelTaskRow } from "./dto";

const WS = "ws-1";
const USER = "user-1";
const PEER = "user-2";
const TASK_ID = "660e8400-e29b-41d4-a716-446655440111";

/**
 * The two lanes. `agentCtx` = bearer agent token (every MCP `op="post"`);
 * `desktopCtx` = cookie caller (desktop listener + web), the lane that
 * legitimately writes lifecycle markers.
 */
const agentCtx: ChannelContext = {
  workspaceId: WS,
  userId: USER,
  source: "agent",
  role: "member",
};
const desktopCtx: ChannelContext = { ...agentCtx, source: "user" };

const LIFECYCLE_KINDS = ["task_started", "task_finished", "task_failed"] as const;

function channelRow(): ChannelRow {
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
  };
}

function memberRow(userId: string): ChannelMemberRow {
  return {
    channel_id: "chan-1",
    user_id: userId,
    workspace_id: WS,
    role: "owner",
    last_read_at: null,
    notify_scope: "all",
    agent_tool_profile: "full",
    added_by: USER,
    joined_at: "2026-07-20T00:00:00Z",
  };
}

function taskRow(overrides: Partial<ChannelTaskRow> = {}): ChannelTaskRow {
  return {
    id: TASK_ID,
    channel_id: "chan-1",
    workspace_id: WS,
    title: "Ship it",
    status: "open",
    outcome: null,
    mode: "interactive",
    created_by: USER,
    target_user_id: PEER,
    created_at: "2026-07-20T00:00:00Z",
    updated_at: "2026-07-20T00:00:00Z",
    closed_at: null,
    outcome_summary: null,
    ...overrides,
  };
}

function insertedRow(
  row: Parameters<typeof repoMessages.insertMessage>[0]
): ChannelMessageRow {
  return {
    id: "msg-1",
    seq: 42,
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

/** The one insert a call made, or undefined when it wrote nothing. */
function inserted() {
  return vi.mocked(repoMessages.insertMessage).mock.calls[0]?.[0];
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(repo.findChannelBySlug).mockResolvedValue(channelRow());
  vi.mocked(repo.findMembership).mockResolvedValue(memberRow(USER));
  vi.mocked(repo.listMembers).mockResolvedValue([memberRow(USER), memberRow(PEER)]);
  vi.mocked(repo.touchChannel).mockResolvedValue(undefined);
  vi.mocked(repo.fetchProfiles).mockResolvedValue([]);
  vi.mocked(repoMessages.findMessageByClientId).mockResolvedValue(null);
  vi.mocked(repoMessages.insertMessage).mockImplementation(async (row) => insertedRow(row));
  // Re-proposal anchor. 0 = "nothing said in this thread yet".
  vi.mocked(repoMessages.latestThreadActivitySeq).mockResolvedValue(0);
  vi.mocked(repoTasks.findTaskByChannelAndId).mockResolvedValue(taskRow());
  vi.mocked(repoTasks.listTasksByChannel).mockResolvedValue([]);
  vi.mocked(repoTasks.updateTask).mockImplementation(async (_id, patch) =>
    taskRow({ ...patch })
  );
  // Close goes through the CONDITIONAL update, so first-write-wins is decided
  // by the statement rather than by a read.
  vi.mocked(repoTasks.updateTaskIfStatus).mockImplementation(
    async (_id, _status, patch) => taskRow({ ...patch })
  );
});

// ── 1. the refusal ─────────────────────────────────────────────────────────────

describe("postMessage — an AGENT TOKEN cannot post a lifecycle kind", () => {
  it.each(LIFECYCLE_KINDS)("refuses %s and writes nothing at all", async (kind) => {
    await expect(
      postMessage(agentCtx, "general", { body: "Here is the finished analysis…", kind })
    ).rejects.toBeInstanceOf(ChannelLifecycleKindForbiddenError);
    // ⚠ Nothing was SENT, not merely reported — the failure mode is an agent
    // believing it delivered.
    expect(repoMessages.insertMessage).not.toHaveBeenCalled();
  });

  it("names the kind and says where the prose goes instead", async () => {
    const err: Error = await postMessage(agentCtx, "general", {
      body: "done",
      kind: "task_finished",
    }).then(
      () => new Error("the post was NOT refused"),
      (e: Error) => e
    );
    expect(err.message).toContain("task_finished");
    expect(err.message).toContain("Post your message with no kind");
    expect(err.message).toContain("task_progress");
  });

  it("refuses BEFORE the idempotency short-circuit, so a retry cannot replay it", async () => {
    // ⚠ If the guard sat AFTER, a refused caller could re-send the same
    // client_msg_id, hit `findMessageByClientId`, and be handed a stored message
    // back as if the post succeeded.
    vi.mocked(repoMessages.findMessageByClientId).mockResolvedValue(
      insertedRow({
        channel_id: "chan-1",
        workspace_id: WS,
        author_user_id: USER,
        author_kind: "agent",
        kind: "task_finished",
        body: "done",
        metadata: {},
        client_msg_id: "k1",
      })
    );
    await expect(
      postMessage(agentCtx, "general", {
        body: "done",
        kind: "task_finished",
        clientMsgId: "k1",
      })
    ).rejects.toBeInstanceOf(ChannelLifecycleKindForbiddenError);
    expect(repoMessages.findMessageByClientId).not.toHaveBeenCalled();
  });
});

// ── 2. what must keep working ──────────────────────────────────────────────────

describe("postMessage — the lanes the guard must NOT touch", () => {
  it("task_progress stays agent-writable: it is the milestone lane", async () => {
    // Only `task_*` kind whose body IS rendered (`splitSessionEntries`) and the
    // only one claiming nothing about lifecycle.
    const msg = await postMessage(agentCtx, "general", {
      body: "schema half landed",
      kind: "task_progress",
    });
    expect(msg.kind).toBe("task_progress");
    expect(inserted()?.kind).toBe("task_progress");
  });

  it("a plain message from an agent is untouched (the whole point of the rule)", async () => {
    const msg = await postMessage(agentCtx, "general", { body: "Here is the answer." });
    expect(msg.kind).toBe("message");
  });

  it.each(LIFECYCLE_KINDS)(
    "the DESKTOP RUNTIME still posts %s on its cookie session",
    async (kind) => {
      // `main/session-window.js` onLaunched/onEnded → `channel-post.postTaskEvent`
      // → `listener-io.apiFetch`, on the Electron session's Supabase cookies.
      const msg = await postMessage(desktopCtx, "general", {
        body: "Started working on this request.",
        kind,
        authorKind: "agent",
      });
      expect(msg.kind).toBe(kind);
      // ⚠ Still an AGENT-authored row — the guard is about the CREDENTIAL.
      expect(inserted()?.author_kind).toBe("agent");
    }
  );

  it("the CLOSE ECHO is exempt even on an agent ctx (the server speaking, not the agent)", async () => {
    // The one server-internal caller, exempted at its CALL SITE rather than by
    // identity: a close raised over MCP arrives with an agent ctx and the echo
    // still has to tell the peer's card the thread ended.
    await closeTask(desktopCtx, "general", TASK_ID, "completed", "Shipped");
    expect(inserted()?.kind).toBe("task_finished");
    expect(inserted()?.body).toBe("Shipped");
  });

  it("the exemption is NOT a general agent-ctx hole", async () => {
    // ⚠ A caller passing the key inside its own metadata gets no exemption.
    await expect(
      postMessage(agentCtx, "general", {
        body: "done",
        kind: "task_finished",
        metadata: { internalLifecycle: true },
      })
    ).rejects.toBeInstanceOf(ChannelLifecycleKindForbiddenError);
  });
});

// ── 3. propose-then-confirm ────────────────────────────────────────────────────

describe("closeTask / proposeTaskClose — an agent proposes, a human closes", () => {
  it("an AGENT TOKEN cannot close, and nothing about the thread changes", async () => {
    await expect(
      closeTask(agentCtx, "general", TASK_ID, "completed", "all done")
    ).rejects.toBeInstanceOf(ThreadCloseIsHumanOnlyError);
    expect(repoTasks.updateTaskIfStatus).not.toHaveBeenCalled();
    expect(repoMessages.insertMessage).not.toHaveBeenCalled();
  });

  it("the refusal comes BEFORE any lookup, so it leaks nothing about the thread", async () => {
    // ⚠ Non-party and nonexistent thread ids must answer IDENTICALLY, else the
    // shape of the error is a probe.
    vi.mocked(repoTasks.findTaskByChannelAndId).mockResolvedValue(null);
    await expect(
      closeTask(agentCtx, "general", TASK_ID, "completed")
    ).rejects.toBeInstanceOf(ThreadCloseIsHumanOnlyError);
    expect(repoTasks.findTaskByChannelAndId).not.toHaveBeenCalled();
  });

  it("a HUMAN closes exactly as before", async () => {
    const { thread } = await closeTask(desktopCtx, "general", TASK_ID, "completed", "Shipped");
    expect(thread.status).toBe("closed");
    expect(vi.mocked(repoTasks.updateTaskIfStatus).mock.calls[0][2].status).toBe("closed");
  });

  it("an agent's PROPOSAL posts a marked, NON-TERMINAL note and touches no row", async () => {
    const res = await proposeTaskClose(agentCtx, "general", TASK_ID, "completed", "Analysis is in.");

    // ⚠ Thread UNTOUCHED — a proposal must not change routing, status, or
    // anything the peer sees.
    expect(repoTasks.updateTask).not.toHaveBeenCalled();
    expect(repoTasks.updateTaskIfStatus).not.toHaveBeenCalled();
    expect(res.thread.status).toBe("open");

    const row = inserted();
    // ⚠ Non-terminal by construction: `task_progress` is an `entries` row in
    // `groupThread`, never an `endEvent`.
    expect(row?.kind).toBe("task_progress");
    expect(row?.body).toBe("Analysis is in.");
    expect(row?.metadata).toMatchObject({
      taskId: TASK_ID,
      closeProposed: true,
      closeOutcome: "completed",
    });
    expect(res.markerSeq).toBe(42);
    expect(res.outcome).toBe("completed");
  });

  it("a proposal with no reason still says something a human can act on", async () => {
    await proposeTaskClose(agentCtx, "general", TASK_ID, "failed");
    expect(inserted()?.body).toBe("I think this thread can be closed.");
    expect(inserted()?.metadata).toMatchObject({ closeOutcome: "failed" });
  });

  /**
   * ⚠ `propose_close` is RE-RAISABLE. Key is (thread, outcome, ACTIVITY ANCHOR)
   * and the anchor EXCLUDES proposals — that is what keeps a retry deduping
   * while a genuine re-proposal still writes. A `(thread, outcome)` key alone is
   * one-shot forever and silently swallows the second real proposal.
   * Both directions asserted: satisfying only one is the bug or the spam.
   */
  it("keys the proposal on (thread, outcome, activity anchor)", async () => {
    vi.mocked(repoMessages.latestThreadActivitySeq).mockResolvedValue(17);
    await proposeTaskClose(agentCtx, "general", TASK_ID, "completed");
    expect(inserted()?.client_msg_id).toBe(
      `close-proposed-${TASK_ID}-completed-17`
    );
    expect(repoMessages.latestThreadActivitySeq).toHaveBeenCalledWith(
      "chan-1",
      TASK_ID
    );
  });

  it("a RETRY with nothing said in between still collapses to one prompt", async () => {
    // Anchor excludes proposals, so posting one does not move it — retries all
    // recompute the SAME key and hit the idempotency short-circuit.
    vi.mocked(repoMessages.latestThreadActivitySeq).mockResolvedValue(17);
    await proposeTaskClose(agentCtx, "general", TASK_ID, "completed");
    const first = inserted()?.client_msg_id;

    vi.mocked(repoMessages.insertMessage).mockClear();
    await proposeTaskClose(agentCtx, "general", TASK_ID, "completed");

    expect(inserted()?.client_msg_id).toBe(first);
  });

  it("a proposal raised AFTER more exchange writes a NEW prompt", async () => {
    // propose → human keeps it open → work continues → propose again. Thread
    // moved, so anchor moved, so the key is new.
    vi.mocked(repoMessages.latestThreadActivitySeq).mockResolvedValue(17);
    await proposeTaskClose(agentCtx, "general", TASK_ID, "completed");
    const first = inserted()?.client_msg_id;

    vi.mocked(repoMessages.insertMessage).mockClear();
    vi.mocked(repoMessages.latestThreadActivitySeq).mockResolvedValue(31);
    await proposeTaskClose(agentCtx, "general", TASK_ID, "completed");

    expect(inserted()?.client_msg_id).not.toBe(first);
    expect(inserted()?.client_msg_id).toBe(
      `close-proposed-${TASK_ID}-completed-31`
    );
  });

  it("the outcome still separates two proposals at the same anchor", async () => {
    // ⚠ "this failed" and "this is done" are different claims — must not dedupe.
    vi.mocked(repoMessages.latestThreadActivitySeq).mockResolvedValue(9);
    await proposeTaskClose(agentCtx, "general", TASK_ID, "completed");
    const completed = inserted()?.client_msg_id;

    vi.mocked(repoMessages.insertMessage).mockClear();
    await proposeTaskClose(agentCtx, "general", TASK_ID, "failed");

    expect(inserted()?.client_msg_id).not.toBe(completed);
  });

  it("does NOT share a key namespace with the stale-thread cron", async () => {
    // ⚠ Different authors, different claims, DIFFERENT KEYS — sharing a key lets
    // a scheduled sweep landing first replace an agent's stated reason.
    vi.mocked(repoMessages.latestThreadActivitySeq).mockResolvedValue(17);
    await proposeTaskClose(agentCtx, "general", TASK_ID, "completed");
    expect(inserted()?.client_msg_id).not.toBe(`stale-swept-${TASK_ID}-17`);
    expect(inserted()?.client_msg_id?.startsWith("close-proposed-")).toBe(true);
  });

  it("a member who could not CLOSE the thread cannot PROPOSE on it either", async () => {
    // ⚠ Proposing raises a one-click prompt in front of a human — must not be
    // reachable by somebody the close itself would refuse.
    vi.mocked(repoTasks.findTaskByChannelAndId).mockResolvedValue(
      taskRow({ created_by: "someone-else", target_user_id: "another" })
    );
    await expect(
      proposeTaskClose(agentCtx, "general", TASK_ID, "completed")
    ).rejects.toBeInstanceOf(TaskForbiddenError);
    expect(repoMessages.insertMessage).not.toHaveBeenCalled();
  });

  it("the close-proposal keys are RESERVED: a caller cannot forge the prompt", async () => {
    // ⚠ A peer able to stamp `closeProposed` on somebody else's thread could
    // manufacture the confirm prompt, so the keys are stripped from caller
    // metadata unconditionally and re-stamped only server-internally.
    await postMessage(agentCtx, "general", {
      body: "nothing to see here",
      kind: "task_progress",
      metadata: { taskId: TASK_ID, closeProposed: true, closeOutcome: "completed" },
    });
    const meta = inserted()?.metadata as Record<string, unknown>;
    expect(meta.closeProposed).toBeUndefined();
    expect(meta.closeOutcome).toBeUndefined();
  });
});
