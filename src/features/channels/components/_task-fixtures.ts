import type {
  ChannelTask,
  ChannelTaskDetail,
  ChannelTaskSubtask,
  TaskActor,
} from "../types";

export const VIEWER = "u-me";
export const PEER = "u-grace";
export const AGENT_ID = "scout001";
export const T0 = "2026-10-26T10:00:00.000Z";

export const agentActor: TaskActor = { kind: "agent", agentId: AGENT_ID, userId: PEER };
export const personActor: TaskActor = { kind: "person", userId: VIEWER };

export function makeSubtask(over: Partial<ChannelTaskSubtask> = {}): ChannelTaskSubtask {
  return {
    id: "s-1",
    title: "Read the retry doc",
    detail: null,
    owner: agentActor,
    state: "todo",
    position: 1,
    createdAt: T0,
    updatedAt: T0,
    ...over,
  };
}

export function makeTask(over: Partial<ChannelTask> = {}): ChannelTask {
  return {
    id: "t-1",
    channelId: "c-1",
    workspaceId: "ws-1",
    title: "Fix upload retries",
    description: "Retries time out instead of backing off.",
    status: "open",
    createdBy: agentActor,
    assignees: [agentActor, personActor],
    link: { kind: "thread", threadId: "th-1", title: "Upload retry path" },
    dueAt: null,
    progress: null,
    active: [],
    createdAt: T0,
    updatedAt: T0,
    resolvedAt: null,
    resolvedBy: null,
    ...over,
  };
}

export function makeDetail(over: Partial<ChannelTaskDetail> = {}): ChannelTaskDetail {
  const subtasks = over.subtasks ?? [
    makeSubtask({ id: "s-1", state: "done" }),
    makeSubtask({ id: "s-2", title: "Add backoff", state: "in_progress", position: 2 }),
    makeSubtask({ id: "s-3", title: "Ship it", owner: personActor, position: 3 }),
  ];
  return {
    ...makeTask({ progress: { done: 1, total: subtasks.length }, active: [agentActor] }),
    subtasks,
    notes: [{ id: "n-1", author: agentActor, body: "Following the doc.", createdAt: T0 }],
    notesTruncated: false,
    ...over,
  };
}
