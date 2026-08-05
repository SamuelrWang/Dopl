/**
 * P0-2 — THE LIFECYCLE KINDS ARE NOT AN AGENT'S TO POST (2026-08-04).
 *
 * THE INCIDENT. Two agents exchanged over a DM. The responder did the work and
 * posted its whole answer as `kind:"task_finished"`, and the answer appeared
 * NOWHERE on the requester's side: `lib/group-thread.ts` folds a terminal marker
 * into `draft.endEvent` and never pushes it to `draft.entries`, so its body is
 * structurally unrenderable. The prompt invited the choice and the tool's flat
 * five-value `kind` enum made it one keystroke away.
 *
 * WHAT THIS SUITE IS FOR, and why it is not the MCP tool's suite. The tool
 * refuses those three before the call is made (fast, teaching, "nothing was
 * sent" trivially true — `channel-ops-write.ts`, pinned in the mcp-server
 * package). This is the AUTHORITATIVE half: the one that holds for anything that
 * posts straight at `/api/channels/[id]/messages` with a device token, which is
 * every external agent and every future client.
 *
 * THE SEAM IS THE CREDENTIAL, and pinning it is most of the value here, because
 * getting it wrong in either direction is a real outage:
 *   - too wide, and the DESKTOP RUNTIME's own lifecycle echoes stop
 *     (`main/session-window.js` onLaunched/onEnded → `channel-post.postTaskEvent`,
 *     which posts on the Electron session's SUPABASE COOKIES, so `source:"user"`),
 *     and every session card in the product stops saying whether work started;
 *   - too wide the other way, and the CLOSE ROUTE's own echo stops, so a closed
 *     thread never tells the peer's card it ended;
 *   - too narrow, and the incident comes straight back.
 * All three are asserted below, in both directions.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./repository");
vi.mock("./repository-messages");
vi.mock("./repository-tasks");

import * as repo from "./repository";
import * as repoMessages from "./repository-messages";
import * as repoTasks from "./repository-tasks";
import { postMessage } from "./service-writes";
import { closeTask } from "./service-tasks";
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
 * THE TWO LANES, side by side, because the whole guard is the difference.
 *
 * `agentCtx` is what `buildChannelContext` produces for a BEARER agent token
 * (`with-auth.ts` sets `agentTokenId`, `service-shared.ts` maps it to
 * `source:"agent"`), i.e. every MCP `op="post"`.
 *
 * `desktopCtx` is what the SAME function produces for a cookie caller — the
 * desktop listener and the web app both — and it is the lane that legitimately
 * writes lifecycle markers. The body still declares `authorKind:"agent"`; the
 * marker is agent-authored, it is just not agent-CREDENTIALLED.
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
  vi.mocked(repoTasks.findTaskByChannelAndId).mockResolvedValue(taskRow());
  vi.mocked(repoTasks.listTasksByChannel).mockResolvedValue([]);
  vi.mocked(repoTasks.updateTask).mockImplementation(async (_id, patch) =>
    taskRow({ ...patch })
  );
});

// ── 1. the refusal ─────────────────────────────────────────────────────────────

describe("postMessage — an AGENT TOKEN cannot post a lifecycle kind", () => {
  it.each(LIFECYCLE_KINDS)("refuses %s and writes nothing at all", async (kind) => {
    await expect(
      postMessage(agentCtx, "general", { body: "Here is the finished analysis…", kind })
    ).rejects.toBeInstanceOf(ChannelLifecycleKindForbiddenError);
    // NOTHING WAS SENT, and that has to be true rather than merely reported: the
    // whole failure mode is an agent believing it delivered.
    expect(repoMessages.insertMessage).not.toHaveBeenCalled();
  });

  it("names the kind and says where the prose goes instead", async () => {
    // The message is what an agent reads after a -32603, so it carries the
    // remedy, not just the rule.
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
    // The guard sits beside `assertChatIsUnaddressed` for exactly this reason. If
    // it sat after, a caller whose first attempt was refused could re-send with
    // the same client_msg_id, hit `findMessageByClientId`, and be handed a stored
    // message back as if the post had succeeded.
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
    // The one `task_*` kind whose body IS rendered (`splitSessionEntries`), and
    // the one that claims nothing about a session's lifecycle. Closing it would
    // leave an agent no way to mark progress at all.
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
      // → `listener-io.apiFetch`, which authenticates with the Electron session's
      // Supabase cookies. If this ever fails, every session card in the product
      // stops saying whether work started or how it ended.
      const msg = await postMessage(desktopCtx, "general", {
        body: "Started working on this request.",
        kind,
        authorKind: "agent",
      });
      expect(msg.kind).toBe(kind);
      // …and it is still an AGENT-authored row. The guard is about the
      // CREDENTIAL, never about who the message says wrote it.
      expect(inserted()?.author_kind).toBe("agent");
    }
  );

  it("the CLOSE ECHO is exempt even on an agent ctx (the server speaking, not the agent)", async () => {
    // The one server-internal caller. It is exempted at its call site rather than
    // by identity, because a close raised over MCP arrives with an agent ctx and
    // the echo still has to tell the peer's card the thread ended.
    //
    // Reached through `proposeTaskClose`? No — through `closeTask` on the human
    // lane, which is the only thing that raises it. Asserted here beside the
    // guard so the exemption cannot be removed without this failing.
    await closeTask(desktopCtx, "general", TASK_ID, "completed", "Shipped");
    expect(inserted()?.kind).toBe("task_finished");
    expect(inserted()?.body).toBe("Shipped");
  });

  it("the exemption is NOT a general agent-ctx hole", async () => {
    // Belt: the option exists, and nothing an HTTP caller sends can set it. The
    // proof is structural (it is not a field of ChannelMessageCreateInput), and
    // this pins the behavioural half — a caller passing the key inside its own
    // metadata gets no exemption.
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
    expect(repoTasks.updateTask).not.toHaveBeenCalled();
    expect(repoMessages.insertMessage).not.toHaveBeenCalled();
  });

  it("the refusal comes BEFORE any lookup, so it leaks nothing about the thread", async () => {
    // A thread id an agent is not a party to, and one that does not exist, must
    // answer identically — otherwise the shape of the error is a probe.
    vi.mocked(repoTasks.findTaskByChannelAndId).mockResolvedValue(null);
    await expect(
      closeTask(agentCtx, "general", TASK_ID, "completed")
    ).rejects.toBeInstanceOf(ThreadCloseIsHumanOnlyError);
    expect(repoTasks.findTaskByChannelAndId).not.toHaveBeenCalled();
  });

  it("a HUMAN closes exactly as before", async () => {
    const { thread } = await closeTask(desktopCtx, "general", TASK_ID, "completed", "Shipped");
    expect(thread.status).toBe("closed");
    expect(vi.mocked(repoTasks.updateTask).mock.calls[0][1].status).toBe("closed");
  });

  it("an agent's PROPOSAL posts a marked, NON-TERMINAL note and touches no row", async () => {
    const res = await proposeTaskClose(agentCtx, "general", TASK_ID, "completed", "Analysis is in.");

    // THE THREAD IS UNTOUCHED. This is the property the whole design turns on: a
    // proposal must not change routing, status, or anything the peer sees about
    // the thread's state.
    expect(repoTasks.updateTask).not.toHaveBeenCalled();
    expect(res.thread.status).toBe("open");

    const row = inserted();
    // NON-TERMINAL by construction: `task_progress` is an `entries` row in
    // `groupThread`, never an `endEvent`, so a proposal can never paint the
    // shared thread as finished on the peer's card.
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

  it("repeat proposals collapse: the idempotency key is (thread, outcome)", async () => {
    // One prompt, not a pile of them. The key is derived, so the server dedupes
    // a second proposal from a restarted session as well as from a chatty one.
    await proposeTaskClose(agentCtx, "general", TASK_ID, "completed");
    expect(inserted()?.client_msg_id).toBe(`close-proposed-${TASK_ID}-completed`);
  });

  it("a member who could not CLOSE the thread cannot PROPOSE on it either", async () => {
    // Proposing raises a one-click prompt in front of a human; it must not be
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
    // `closeProposed` is what raises a "close this thread?" button in front of a
    // human whose one click settles the exchange for both members. A peer able to
    // stamp it on somebody else's thread could manufacture that prompt, so the
    // keys are stripped from caller metadata unconditionally and re-stamped only
    // from the server-internal option.
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
