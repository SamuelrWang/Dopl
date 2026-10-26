import { describe, expect, it } from "vitest";
import { mapTaskDetail, mapTaskRow, type ChannelTaskReadRow, type TaskSubtaskRow } from "./dto-tasks";

const ME = "11111111-1111-4111-8111-111111111111";
const PEER = "99999999-9999-4999-8999-999999999999";

const sub = (over: Partial<TaskSubtaskRow>): TaskSubtaskRow => ({
  id: "s",
  task_id: "t",
  position: 0,
  title: "Step",
  detail: null,
  owner_user_id: ME,
  owner_agent_id: null,
  state: "todo",
  created_by: ME,
  client_msg_id: null,
  created_at: "2026-10-26T00:00:00Z",
  updated_at: "2026-10-26T00:00:00Z",
  ...over,
});

function row(over: Partial<ChannelTaskReadRow> = {}): ChannelTaskReadRow {
  return {
    id: "t",
    channel_id: "c",
    workspace_id: "w",
    title: "Fix",
    description: "",
    status: "in_progress",
    created_by: ME,
    created_by_agent: "deynelz3",
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

describe("mapTaskRow", () => {
  it("derives progress and the active owners from in-progress subtasks, in order, once each", () => {
    const task = mapTaskRow(
      row({
        channel_task_subtasks: [
          sub({ id: "c", position: 2, state: "in_progress", owner_agent_id: "k2k2q9fh" }),
          sub({ id: "a", position: 0, state: "done" }),
          sub({ id: "b", position: 1, state: "in_progress", owner_user_id: PEER }),
          sub({ id: "d", position: 3, state: "in_progress", owner_agent_id: "k2k2q9fh" }),
        ],
      })
    );
    expect(task.progress).toEqual({ done: 1, total: 4 });
    expect(task.active).toEqual([
      { kind: "person", userId: PEER },
      { kind: "agent", userId: ME, agentId: "k2k2q9fh" },
    ]);
    expect(task.createdBy).toEqual({ kind: "agent", userId: ME, agentId: "deynelz3" });
  });

  it("has no progress without subtasks, and skips an owner whose account is gone", () => {
    expect(mapTaskRow(row()).progress).toBeNull();
    const task = mapTaskRow(
      row({ channel_task_subtasks: [sub({ state: "in_progress", owner_user_id: null })] })
    );
    expect(task.active).toEqual([]);
  });

  it("names the link from its embed, and drops a link whose row is gone", () => {
    expect(
      mapTaskRow(row({ linked_message_id: "m", linked_message: { seq: "41" } })).link
    ).toEqual({ kind: "message", messageId: "m", seq: 41 });
    expect(
      mapTaskRow(row({ linked_thread_id: "th", linked_thread: { title: "Uploads" } })).link
    ).toEqual({ kind: "thread", threadId: "th", title: "Uploads" });
    expect(mapTaskRow(row({ linked_thread_id: "th", linked_thread: null })).link).toBeNull();
  });

  it("drops a resolver whose account is gone", () => {
    const task = mapTaskRow(
      row({ status: "resolved", resolved_at: "2026-10-26T01:00:00Z", resolved_by_agent: "deynelz3" })
    );
    expect(task.resolvedBy).toBeNull();
  });
});

describe("mapTaskDetail", () => {
  it("returns notes oldest first from a newest-first read", () => {
    const note = (id: string, at: string) => ({
      id,
      task_id: "t",
      author_user_id: ME,
      author_agent_id: null,
      body: id,
      client_msg_id: null,
      created_at: at,
    });
    const detail = mapTaskDetail(
      row(),
      [note("new", "2026-10-26T02:00:00Z"), note("old", "2026-10-26T01:00:00Z")],
      true
    );
    expect(detail.notes.map((n) => n.id)).toEqual(["old", "new"]);
    expect(detail.notesTruncated).toBe(true);
  });
});
