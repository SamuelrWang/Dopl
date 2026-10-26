/**
 * Channel tasks: the closed sets, the actor, the read shapes and the write actions, stated once for
 * the server and `@dopl/client`. The two CHECK sets are pinned against the migration by
 * `src/features/channels/task-check-sets.test.ts`.
 */

/** `resolved` is what the app calls closed; leaving it is a `set_status` back to `open`. */
export type TaskStatus = "open" | "in_progress" | "resolved";

export type SubtaskState = "todo" | "in_progress" | "done";

/** An agent acts under its operator's account, so both kinds carry the user id. */
export type TaskActor =
  | { kind: "person"; userId: string }
  | { kind: "agent"; userId: string; agentId: string };

/** How a write names an assignee or owner; an agent's operator is resolved by the server. */
export type TaskActorRef =
  | { kind: "person"; userId: string }
  | { kind: "agent"; agentId: string };

export type TaskLink =
  | { kind: "thread"; threadId: string; title: string }
  | { kind: "message"; messageId: string; seq: number };

export type ChannelTaskSubtask = {
  id: string;
  title: string;
  detail: string | null;
  /** `null` once the owner's account is gone. */
  owner: TaskActor | null;
  state: SubtaskState;
  position: number;
  createdAt: string;
  updatedAt: string;
};

export type ChannelTaskNote = {
  id: string;
  author: TaskActor;
  body: string;
  createdAt: string;
};

export type ChannelTask = {
  id: string;
  channelId: string;
  workspaceId: string;
  title: string;
  description: string;
  status: TaskStatus;
  createdBy: TaskActor;
  assignees: TaskActor[];
  link: TaskLink | null;
  dueAt: string | null;
  /** Done over all subtasks; `null` when there are none. */
  progress: { done: number; total: number } | null;
  /** Owners of in-progress subtasks, in subtask order, once each. Derived, never stored. */
  active: TaskActor[];
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  /** `null` while unresolved, and once the resolver's account is gone. */
  resolvedBy: TaskActor | null;
};

export type ChannelTaskDetail = ChannelTask & {
  subtasks: ChannelTaskSubtask[];
  /** Oldest first. */
  notes: ChannelTaskNote[];
  /** The newest notes were kept and older ones left off. */
  notesTruncated: boolean;
};

export type ChannelTaskPage = { tasks: ChannelTask[]; truncated: boolean };

export type ChannelTaskWriteResult = { task: ChannelTaskDetail };

/** The POST body of `/api/channels/[channelId]/tasks`. A link names a thread or a message `seq`. */
export type ChannelTaskAction =
  | {
      action: "create";
      title: string;
      description?: string;
      assignees?: TaskActorRef[];
      thread?: string;
      message?: number;
      dueAt?: string | null;
      clientMsgId?: string;
    }
  | {
      action: "update";
      task: string;
      title?: string;
      description?: string;
      dueAt?: string | null;
    }
  | { action: "set_status"; task: string; status: TaskStatus }
  | { action: "assign"; task: string; assignee: TaskActorRef }
  | { action: "unassign"; task: string; assignee: TaskActorRef }
  | {
      action: "add_subtask";
      task: string;
      title: string;
      detail?: string;
      owner?: TaskActorRef;
      clientMsgId?: string;
    }
  | {
      action: "update_subtask";
      task: string;
      subtask: string;
      title?: string;
      detail?: string | null;
      owner?: TaskActorRef;
      state?: SubtaskState;
    }
  | { action: "add_note"; task: string; body: string; clientMsgId?: string };
