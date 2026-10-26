/**
 * STAND-IN (new 2026-10-26, channel tasks) — the in-memory task store both task variants read.
 * Keyed by channel id and held at the page, so a channel switch keeps what was resolved.
 * There is no product read or write to replace yet; do NOT port this file.
 */

import { useCallback, useState } from "react";
import { CURRENT_USER_ID } from "../data/demo-imports";
import { seedTasks, type StagingTask } from "../data/staging-tasks";
import type { StagingRow } from "../data/staging-fixture-types";

export type TasksApi = {
  tasksFor: (channelId: string) => StagingTask[];
  /** The viewer resolves (closes) a task. */
  resolve: (channelId: string, taskId: string) => void;
  /** Back to open; the assignees pick it up again. */
  reopen: (channelId: string, taskId: string) => void;
  /** Round 4: check a subtask (to done), or uncheck it (back to to do). */
  toggleSubtask: (channelId: string, taskId: string, subtaskId: string) => void;
  /** Round 4: the viewer posts a note on the task. */
  addNote: (channelId: string, taskId: string, text: string) => void;
};

const NONE: StagingTask[] = [];

export function useStagingTasks(rows: readonly StagingRow[]): TasksApi {
  const [byChannel, setByChannel] = useState<Record<string, StagingTask[]>>(() => {
    const out: Record<string, StagingTask[]> = {};
    for (const row of rows) if (row.kind === "channel") out[row.channel.id] = seedTasks(row);
    return out;
  });

  const patch = useCallback(
    (channelId: string, taskId: string, fn: (t: StagingTask) => StagingTask) =>
      setByChannel((all) => ({
        ...all,
        [channelId]: (all[channelId] ?? NONE).map((t) => (t.id === taskId ? fn(t) : t)),
      })),
    []
  );

  return {
    tasksFor: (channelId) => byChannel[channelId] ?? NONE,
    resolve: (channelId, taskId) => {
      const now = new Date().toISOString();
      patch(channelId, taskId, (t) => ({
        ...t,
        status: "resolved",
        updatedAt: now,
        resolvedAt: now,
        resolvedBy: { kind: "person", userId: CURRENT_USER_ID },
      }));
    },
    reopen: (channelId, taskId) =>
      patch(channelId, taskId, (t) => ({
        ...t,
        status: "open",
        updatedAt: new Date().toISOString(),
        resolvedAt: null,
        resolvedBy: null,
      })),
    toggleSubtask: (channelId, taskId, subtaskId) =>
      patch(channelId, taskId, (t) => ({
        ...t,
        updatedAt: new Date().toISOString(),
        subtasks: t.subtasks.map((s) =>
          s.id === subtaskId ? { ...s, state: s.state === "done" ? "todo" : "done" } : s
        ),
      })),
    addNote: (channelId, taskId, text) => {
      const now = new Date().toISOString();
      patch(channelId, taskId, (t) => ({
        ...t,
        updatedAt: now,
        notes: [
          ...t.notes,
          {
            id: `note-viewer-${t.notes.length + 1}-${now}`,
            author: { kind: "person", userId: CURRENT_USER_ID },
            at: now,
            text,
          },
        ],
      }));
    },
  };
}
