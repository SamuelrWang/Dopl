import { describe, it, expect, vi, beforeEach } from "vitest";

// One double, `loadVisibleChannel`; the membership `if` of `requireMemberChannel` runs for real on it.
vi.mock("./service-shared", async () => {
  const { ChannelForbiddenError } = await import("./errors");
  const loadVisibleChannel = vi.fn();
  return {
    UNIQUE_VIOLATION: "23505",
    loadVisibleChannel,
    requireMemberChannel: vi.fn(async (ctx: unknown, ref: string, action: string) => {
      const { channel, membership } = (await loadVisibleChannel(ctx as never, ref)) as {
        channel: unknown;
        membership: unknown;
      };
      if (!membership) throw new ChannelForbiddenError(action);
      return { channel, membership };
    }),
  };
});
vi.mock("./repository-tasks", () => ({
  insertTask: vi.fn(),
  findOwnTaskIdByClientId: vi.fn(),
  findTask: vi.fn(),
  listTasks: vi.fn(),
  updateTask: vi.fn(),
  insertAssignee: vi.fn(),
  deleteAssignee: vi.fn(),
  insertSubtask: vi.fn(),
  findOwnSubtaskIdByClientId: vi.fn(),
  updateSubtask: vi.fn(),
  insertNote: vi.fn(),
  findOwnNoteIdByClientId: vi.fn(),
  listNotes: vi.fn(),
}));
vi.mock("./repository", () => ({ hasMembership: vi.fn(), pgErrorCode: () => null }));
vi.mock("./repository-sessions", () => ({ sessionRowsWhere: vi.fn() }));
vi.mock("./repository-threads", () => ({ findThreadByChannelAndId: vi.fn() }));
vi.mock("./repository-messages", () => ({ findMessageRefsBySeqs: vi.fn() }));
vi.mock("./service-writes", () => ({ postMessage: vi.fn() }));

import * as repoTasks from "./repository-tasks";
import * as repo from "./repository";
import * as repoSessions from "./repository-sessions";
import * as repoMessages from "./repository-messages";
import { postMessage } from "./service-writes";
import { loadVisibleChannel, type ChannelContext } from "./service-shared";
import {
  ChannelForbiddenError,
  SubtaskNotFoundError,
  TaskActorUnresolvedError,
  TaskLimitError,
  TaskLinkUnresolvedError,
  TaskNotFoundError,
} from "./errors";
import type { ChannelTaskReadRow, TaskSubtaskRow } from "./dto-tasks";
import { applyTaskAction } from "./service-tasks";

const CHANNEL = "44444444-4444-4444-8444-444444444444";
const WORKSPACE = "22222222-2222-4222-8222-222222222222";
const ME = "11111111-1111-4111-8111-111111111111";
const PEER = "99999999-9999-4999-8999-999999999999";
const TASK = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const MY_AGENT = "deynelz3";
const OTHER_AGENT = "k2k2q9fh";

const person = { workspaceId: WORKSPACE, userId: ME, source: "user", role: "member" } as ChannelContext;
const agent = { ...person, source: "agent", sessionId: `${CHANNEL}::${MY_AGENT}` } as ChannelContext;
const guest = { ...person, role: "guest" } as ChannelContext;

function taskRow(over: Partial<ChannelTaskReadRow> = {}): ChannelTaskReadRow {
  return {
    id: TASK,
    channel_id: CHANNEL,
    workspace_id: WORKSPACE,
    title: "Fix teardown",
    description: "",
    status: "open",
    created_by: ME,
    created_by_agent: null,
    linked_thread_id: null,
    linked_message_id: null,
    due_at: null,
    resolved_at: null,
    resolved_by: null,
    resolved_by_agent: null,
    client_msg_id: null,
    created_at: "2026-10-26T00:00:00Z",
    updated_at: "2026-10-26T00:00:00Z",
    channel_task_assignees: [],
    channel_task_subtasks: [],
    linked_thread: null,
    linked_message: null,
    ...over,
  };
}

const subtask = (position: number): TaskSubtaskRow => ({
  id: `sub-${position}`,
  task_id: TASK,
  position,
  title: "Step",
  detail: null,
  owner_user_id: ME,
  owner_agent_id: null,
  state: "todo",
  created_by: ME,
  client_msg_id: null,
  created_at: "2026-10-26T00:00:00Z",
  updated_at: "2026-10-26T00:00:00Z",
});

const seeChannel = (membership: unknown = { role: "member" }) =>
  vi.mocked(loadVisibleChannel).mockResolvedValue({
    channel: { id: CHANNEL, workspace_id: WORKSPACE },
    membership,
  } as never);

/** An agent `agentId` live in this channel, run by `operator`. */
const liveAgent = (operator: string) =>
  vi.mocked(repoSessions.sessionRowsWhere).mockResolvedValue([{ user_id: operator }] as never);

beforeEach(() => {
  vi.clearAllMocks();
  seeChannel();
  vi.mocked(repoTasks.findTask).mockResolvedValue(taskRow());
  vi.mocked(repoTasks.listNotes).mockResolvedValue([]);
  vi.mocked(repoTasks.insertTask).mockResolvedValue(TASK);
  vi.mocked(repoTasks.insertAssignee).mockResolvedValue("assignee-1");
  vi.mocked(repo.hasMembership).mockResolvedValue(true);
  vi.mocked(repoSessions.sessionRowsWhere).mockResolvedValue([]);
});

describe("R8: a guest reads and adds notes, nothing else", () => {
  it("refuses a guest's create and writes nothing", async () => {
    await expect(
      applyTaskAction(guest, CHANNEL, { action: "create", title: "x" })
    ).rejects.toBeInstanceOf(ChannelForbiddenError);
    expect(repoTasks.insertTask).not.toHaveBeenCalled();
  });

  it("lets a guest add a note", async () => {
    await applyTaskAction(guest, CHANNEL, { action: "add_note", task: TASK, body: "seen" });
    expect(repoTasks.insertNote).toHaveBeenCalledWith(
      expect.objectContaining({ author_user_id: ME, author_agent_id: null, body: "seen" })
    );
  });

  it("refuses a public-channel reader who is not a member", async () => {
    seeChannel(null);
    await expect(
      applyTaskAction(person, CHANNEL, { action: "add_note", task: TASK, body: "x" })
    ).rejects.toBeInstanceOf(ChannelForbiddenError);
    expect(repoTasks.insertNote).not.toHaveBeenCalled();
  });
});

describe("create", () => {
  it("stamps the agent from the session key and wakes an assigned agent through postMessage (R7)", async () => {
    liveAgent(ME);
    await applyTaskAction(agent, CHANNEL, {
      action: "create",
      title: "Fix teardown",
      assignees: [{ kind: "agent", agentId: OTHER_AGENT }],
    });
    expect(repoTasks.insertTask).toHaveBeenCalledWith(
      expect.objectContaining({ created_by: ME, created_by_agent: MY_AGENT })
    );
    expect(repoTasks.insertAssignee).toHaveBeenCalledWith(TASK, ME, OTHER_AGENT);
    expect(postMessage).toHaveBeenCalledWith(
      agent,
      CHANNEL,
      expect.objectContaining({ to: `@agent-${OTHER_AGENT}`, clientMsgId: `task-${TASK}-assign-assignee-1` }),
      { assignedTaskId: TASK }
    );
  });

  it("posts nothing for a person assignee", async () => {
    await applyTaskAction(person, CHANNEL, {
      action: "create",
      title: "x",
      assignees: [{ kind: "person", userId: PEER }],
    });
    expect(repoTasks.insertAssignee).toHaveBeenCalledWith(TASK, PEER, null);
    expect(postMessage).not.toHaveBeenCalled();
  });

  it("converges on the caller's own task for a retried clientMsgId", async () => {
    vi.mocked(repoTasks.findOwnTaskIdByClientId).mockResolvedValue(TASK);
    const { task } = await applyTaskAction(person, CHANNEL, {
      action: "create",
      title: "x",
      clientMsgId: "k1",
      assignees: [{ kind: "person", userId: PEER }],
    });
    expect(task.id).toBe(TASK);
    expect(repoTasks.insertTask).not.toHaveBeenCalled();
    expect(repoTasks.insertAssignee).not.toHaveBeenCalled();
  });

  it("refuses a message link outside this channel before writing", async () => {
    vi.mocked(repoMessages.findMessageRefsBySeqs).mockResolvedValue([]);
    await expect(
      applyTaskAction(person, CHANNEL, { action: "create", title: "x", message: 41 })
    ).rejects.toBeInstanceOf(TaskLinkUnresolvedError);
    expect(repoTasks.insertTask).not.toHaveBeenCalled();
  });

  it("refuses a person who is not a channel member", async () => {
    vi.mocked(repo.hasMembership).mockResolvedValue(false);
    await expect(
      applyTaskAction(person, CHANNEL, {
        action: "create",
        title: "x",
        assignees: [{ kind: "person", userId: PEER }],
      })
    ).rejects.toBeInstanceOf(TaskActorUnresolvedError);
    expect(repoTasks.insertTask).not.toHaveBeenCalled();
  });
});

describe("assign", () => {
  it("refuses an agent credential assigning a peer's agent", async () => {
    liveAgent(PEER);
    await expect(
      applyTaskAction(agent, CHANNEL, {
        action: "assign",
        task: TASK,
        assignee: { kind: "agent", agentId: OTHER_AGENT },
      })
    ).rejects.toBeInstanceOf(ChannelForbiddenError);
    expect(repoTasks.insertAssignee).not.toHaveBeenCalled();
  });

  it("lets a person assign a peer's agent, filed under that agent's operator", async () => {
    liveAgent(PEER);
    await applyTaskAction(person, CHANNEL, {
      action: "assign",
      task: TASK,
      assignee: { kind: "agent", agentId: OTHER_AGENT },
    });
    expect(repoTasks.insertAssignee).toHaveBeenCalledWith(TASK, PEER, OTHER_AGENT);
    expect(postMessage).toHaveBeenCalledTimes(1);
  });

  it("does not wake an agent assigning itself, or re-wake an existing assignee", async () => {
    liveAgent(ME);
    await applyTaskAction(agent, CHANNEL, {
      action: "assign",
      task: TASK,
      assignee: { kind: "agent", agentId: MY_AGENT },
    });
    vi.mocked(repoTasks.insertAssignee).mockResolvedValue(null);
    await applyTaskAction(person, CHANNEL, {
      action: "assign",
      task: TASK,
      assignee: { kind: "agent", agentId: OTHER_AGENT },
    });
    expect(postMessage).not.toHaveBeenCalled();
  });

  it("takes the new row back out when the wake post fails, so a retry wakes the agent", async () => {
    liveAgent(PEER);
    const down = new Error("post failed");
    vi.mocked(postMessage).mockRejectedValueOnce(down);
    const assign = () =>
      applyTaskAction(person, CHANNEL, {
        action: "assign",
        task: TASK,
        assignee: { kind: "agent", agentId: OTHER_AGENT },
      });
    await expect(assign()).rejects.toBe(down);
    expect(repoTasks.deleteAssignee).toHaveBeenCalledWith(TASK, { agentId: OTHER_AGENT });
    await assign();
    expect(postMessage).toHaveBeenCalledTimes(2);
    expect(repoTasks.deleteAssignee).toHaveBeenCalledTimes(1);
  });

  it("refuses an agent with no session in this channel", async () => {
    await expect(
      applyTaskAction(person, CHANNEL, {
        action: "assign",
        task: TASK,
        assignee: { kind: "agent", agentId: OTHER_AGENT },
      })
    ).rejects.toBeInstanceOf(TaskActorUnresolvedError);
  });

  it("unassigns an agent by id alone, without a live session", async () => {
    await applyTaskAction(person, CHANNEL, {
      action: "unassign",
      task: TASK,
      assignee: { kind: "agent", agentId: OTHER_AGENT },
    });
    expect(repoTasks.deleteAssignee).toHaveBeenCalledWith(TASK, { agentId: OTHER_AGENT });
    expect(repoSessions.sessionRowsWhere).not.toHaveBeenCalled();
  });
});

describe("set_status (R5)", () => {
  it("stamps the resolver on resolve and clears it on any other status", async () => {
    await applyTaskAction(agent, CHANNEL, { action: "set_status", task: TASK, status: "resolved" });
    expect(repoTasks.updateTask).toHaveBeenLastCalledWith(
      CHANNEL,
      TASK,
      expect.objectContaining({ status: "resolved", resolved_by: ME, resolved_by_agent: MY_AGENT })
    );
    vi.mocked(repoTasks.findTask).mockResolvedValue(
      taskRow({ status: "resolved", resolved_at: "2026-10-26T01:00:00Z", resolved_by: ME })
    );
    await applyTaskAction(person, CHANNEL, { action: "set_status", task: TASK, status: "open" });
    expect(repoTasks.updateTask).toHaveBeenLastCalledWith(CHANNEL, TASK, {
      status: "open",
      resolved_at: null,
      resolved_by: null,
      resolved_by_agent: null,
    });
  });

  it("writes nothing when the status is unchanged", async () => {
    await applyTaskAction(person, CHANNEL, { action: "set_status", task: TASK, status: "open" });
    expect(repoTasks.updateTask).not.toHaveBeenCalled();
  });

  it("answers not-found for a task outside this channel", async () => {
    vi.mocked(repoTasks.findTask).mockResolvedValue(null);
    await expect(
      applyTaskAction(person, CHANNEL, { action: "set_status", task: TASK, status: "resolved" })
    ).rejects.toBeInstanceOf(TaskNotFoundError);
  });
});

describe("subtasks", () => {
  it("appends after the last position, owned by the caller by default", async () => {
    vi.mocked(repoTasks.findTask).mockResolvedValue(
      taskRow({ channel_task_subtasks: [subtask(0), subtask(3)] })
    );
    await applyTaskAction(agent, CHANNEL, { action: "add_subtask", task: TASK, title: "Next" });
    expect(repoTasks.insertSubtask).toHaveBeenCalledWith(
      expect.objectContaining({ position: 4, owner_user_id: ME, owner_agent_id: MY_AGENT })
    );
  });

  it("refuses past the cap", async () => {
    vi.mocked(repoTasks.findTask).mockResolvedValue(
      taskRow({ channel_task_subtasks: Array.from({ length: 50 }, (_, i) => subtask(i)) })
    );
    await expect(
      applyTaskAction(person, CHANNEL, { action: "add_subtask", task: TASK, title: "x" })
    ).rejects.toBeInstanceOf(TaskLimitError);
    expect(repoTasks.insertSubtask).not.toHaveBeenCalled();
  });

  it("answers not-found for a subtask of another task", async () => {
    vi.mocked(repoTasks.updateSubtask).mockResolvedValue(false);
    await expect(
      applyTaskAction(person, CHANNEL, {
        action: "update_subtask",
        task: TASK,
        subtask: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        state: "done",
      })
    ).rejects.toBeInstanceOf(SubtaskNotFoundError);
  });
});
