"use client";

import {
  patchCache,
  useApiMutationWith,
  type MutationGate,
  type UseApiMutationConfig,
} from "@/shared/hooks/use-api-mutation";
import { channelRequest } from "../client/api";
import { channelKeys, channelTasksPath } from "../client/query-keys";
import { newClientMsgId } from "../lib/optimistic-cache";
import { nextSubtaskState, subtaskFacts } from "../lib/task-model";
import { failed } from "./use-writes-shared";
import type {
  ChannelTask,
  ChannelTaskAction,
  ChannelTaskDetail,
  ChannelTaskPage,
  ChannelTaskSubtask,
  ChannelTaskWriteResult,
  SubtaskState,
  TaskStatus,
} from "../types";

/**
 * THE TASK WRITES — Resolve / Reopen, a subtask's check, a note. One mutation over the route's
 * action union, settled into the surface's gate (INVARIANTS §7/§8).
 *
 * Every write answers with the whole task, and that answer is folded into the list row and the
 * open detail alike; the status and subtask writes also paint what they expect before they leave.
 */

export interface TaskWriteDraft {
  /** Captured at the click: every key below is built from it. */
  channelId: string;
  action: Exclude<ChannelTaskAction, { action: "create" }>;
  /** What the write is expected to land, painted before the request leaves. */
  expect?: Partial<ChannelTaskDetail>;
}

/** The raw bodies the two read arms cache under one prefix (`use-channel-tasks.ts`). */
type TasksCache = ChannelTaskPage | { task: ChannelTaskDetail };

function rowFields(patch: Partial<ChannelTaskDetail>): Partial<ChannelTask> {
  const row: Partial<ChannelTaskDetail> = { ...patch };
  delete row.subtasks;
  delete row.notes;
  delete row.notesTruncated;
  return row;
}

/** Merge `patch` into task `id` wherever it is cached: a list row takes its row fields, a detail all. */
export function putTask(
  cache: TasksCache | undefined,
  id: string,
  patch: Partial<ChannelTaskDetail>
): TasksCache | undefined {
  if (!cache) return cache;
  if ("tasks" in cache) {
    const row = rowFields(patch);
    return { ...cache, tasks: cache.tasks.map((t) => (t.id === id ? { ...t, ...row } : t)) };
  }
  return cache.task.id === id ? { task: { ...cache.task, ...patch } } : cache;
}

export function statusExpectation(
  status: TaskStatus,
  viewerId: string,
  now: string
): Partial<ChannelTaskDetail> {
  const resolved = status === "resolved";
  return {
    status,
    updatedAt: now,
    resolvedAt: resolved ? now : null,
    resolvedBy: resolved ? { kind: "person", userId: viewerId } : null,
  };
}

export function subtaskExpectation(
  task: ChannelTaskDetail,
  subtaskId: string,
  state: SubtaskState,
  now: string
): Partial<ChannelTaskDetail> {
  const subtasks = task.subtasks.map((s) =>
    s.id === subtaskId ? { ...s, state, updatedAt: now } : s
  );
  return { subtasks, updatedAt: now, ...subtaskFacts(subtasks) };
}

interface TaskWriteDeps {
  workspaceId: string;
  gate: MutationGate;
}

/** Apart from the hook so a DOM-free test can drive it through TanStack's `MutationObserver`. */
export function taskWriteConfig(
  deps: TaskWriteDeps
): UseApiMutationConfig<TaskWriteDraft, ChannelTaskWriteResult> {
  return {
    request: (draft) => ({
      path: channelTasksPath(draft.channelId),
      method: "POST",
      workspaceId: deps.workspaceId,
      body: draft.action,
    }),
    optimistic: (draft) =>
      draft.expect
        ? patchCache<TasksCache>(channelKeys.tasks(draft.channelId).all, (cache) =>
            putTask(cache, draft.action.task, draft.expect ?? {})
          )
        : null,
    reconcile: (data, draft) =>
      patchCache<TasksCache>(channelKeys.tasks(draft.channelId).all, (cache) =>
        putTask(cache, data.task.id, data.task)
      ),
    settleWith: deps.gate,
    onError: (err) => failed(err, "Couldn't update the task"),
  };
}

/** The three writes the Tasks tab offers; a guest, who reads tasks without changing them, is
 *  offered `addNote` only. */
export function useTaskWrites({
  channelId,
  currentUserId,
  ...deps
}: TaskWriteDeps & { channelId: string; currentUserId: string }) {
  const write = useApiMutationWith<TaskWriteDraft, ChannelTaskWriteResult>(
    channelRequest,
    taskWriteConfig(deps)
  );
  const now = () => new Date().toISOString();
  return {
    setStatus: (task: ChannelTask, status: TaskStatus) =>
      write.mutate({
        channelId,
        action: { action: "set_status", task: task.id, status },
        expect: statusExpectation(status, currentUserId, now()),
      }),
    toggleSubtask: (task: ChannelTaskDetail, subtask: ChannelTaskSubtask) => {
      const state = nextSubtaskState(subtask.state);
      write.mutate({
        channelId,
        action: { action: "update_subtask", task: task.id, subtask: subtask.id, state },
        expect: subtaskExpectation(task, subtask.id, state, now()),
      });
    },
    /** Resolves once the note landed, so the composer keeps the words until then. */
    addNote: (taskId: string, body: string) =>
      write.mutateAsync({
        channelId,
        action: { action: "add_note", task: taskId, body, clientMsgId: newClientMsgId() },
      }),
    pending: write.pending,
  };
}
