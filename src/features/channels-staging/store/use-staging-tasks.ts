/**
 * STAND-IN — the in-memory task store the product tasks UI reads on
 * this page, in place of `channels/hooks/use-channel-tasks.ts` + `use-task-writes.ts` (network).
 * Keyed by channel id and held at the page, so a channel switch keeps what was resolved. The
 * writes land what the product's own optimistic patches paint (`statusExpectation`,
 * `subtaskExpectation`). Do NOT port this file.
 */

import { useCallback, useState } from "react";
import {
  statusExpectation,
  subtaskExpectation,
} from "@/features/channels/hooks/use-task-writes";
import { nextSubtaskState } from "@/features/channels/lib/task-model";
import type { ChannelTaskDetail, TaskStatus } from "@/features/channels/types";
import { CURRENT_USER_ID } from "../data/demo-imports";
import { seedTasks } from "../data/staging-tasks";
import type { StagingRow } from "../data/staging-fixture-types";

export type TasksApi = {
  tasksFor: (channelId: string) => ChannelTaskDetail[];
  setStatus: (channelId: string, taskId: string, status: TaskStatus) => void;
  /** A subtask's check: done ↔ to do. */
  toggleSubtask: (channelId: string, taskId: string, subtaskId: string) => void;
  /** The viewer posts a note on the task. */
  addNote: (channelId: string, taskId: string, body: string) => Promise<void>;
};

const NONE: ChannelTaskDetail[] = [];

export function useStagingTasks(rows: readonly StagingRow[]): TasksApi {
  const [byChannel, setByChannel] = useState<Record<string, ChannelTaskDetail[]>>(() => {
    const out: Record<string, ChannelTaskDetail[]> = {};
    for (const row of rows) if (row.kind === "channel") out[row.channel.id] = seedTasks(row);
    return out;
  });

  const patch = useCallback(
    (
      channelId: string,
      taskId: string,
      fn: (t: ChannelTaskDetail) => Partial<ChannelTaskDetail>
    ) =>
      setByChannel((all) => ({
        ...all,
        [channelId]: (all[channelId] ?? NONE).map((t) => (t.id === taskId ? { ...t, ...fn(t) } : t)),
      })),
    []
  );

  return {
    tasksFor: (channelId) => byChannel[channelId] ?? NONE,
    setStatus: (channelId, taskId, status) =>
      patch(channelId, taskId, () =>
        statusExpectation(status, CURRENT_USER_ID, new Date().toISOString())
      ),
    toggleSubtask: (channelId, taskId, subtaskId) =>
      patch(channelId, taskId, (t) => {
        const state = nextSubtaskState(t.subtasks.find((s) => s.id === subtaskId)?.state);
        return subtaskExpectation(t, subtaskId, state, new Date().toISOString());
      }),
    addNote: async (channelId, taskId, body) => {
      const now = new Date().toISOString();
      patch(channelId, taskId, (t) => ({
        updatedAt: now,
        notes: [
          ...t.notes,
          {
            id: `note-viewer-${t.notes.length + 1}-${now}`,
            author: { kind: "person", userId: CURRENT_USER_ID },
            createdAt: now,
            body,
          },
        ],
      }));
    },
  };
}
