"use client";

import type { MutationGate } from "@/shared/hooks/use-api-mutation";
import { useChannelTask } from "../hooks/use-channel-tasks";
import { useTaskWrites } from "../hooks/use-task-writes";
import { useTaskFaces } from "./task-faces";
import { TasksPanel } from "./tasks-panel";
import type { AgentFeeds } from "./agent-face";
import type { AuthorIndex } from "./view-model";
import type { ChannelTask, TaskLink } from "../types";

/**
 * The Tasks tab wired to a channel surface. The list is the host's read
 * (`channel-surface-data.ts › tasks`); the open task's detail is read here, mounted with the tab.
 * Writes settle into the surface's one gate.
 */
export function ChannelTasksTab({
  channelId,
  workspaceId,
  index,
  feeds,
  gate,
  tasks,
  truncated,
  loading,
  failed,
  canEdit,
  openTaskId,
  onOpenTask,
  onOpenLink,
}: {
  channelId: string;
  workspaceId: string;
  index: AuthorIndex;
  feeds: AgentFeeds;
  gate: MutationGate;
  tasks: readonly ChannelTask[];
  truncated: boolean;
  loading: boolean;
  failed: boolean;
  /** `false` for a guest, who reads tasks and adds notes but cannot change them. */
  canEdit: boolean;
  openTaskId: string | null;
  onOpenTask: (taskId: string | null) => void;
  onOpenLink: (link: TaskLink) => void;
}) {
  const faceOf = useTaskFaces(index, feeds);
  const listed = tasks.some((t) => t.id === openTaskId) ? openTaskId : null;
  const { task: detail, error: detailError } = useChannelTask(channelId, listed, workspaceId);
  const writes = useTaskWrites({
    channelId,
    workspaceId,
    currentUserId: index.currentUserId,
    gate,
  });
  return (
    <TasksPanel
      tasks={tasks}
      truncated={truncated}
      loading={loading}
      failed={failed}
      faceOf={faceOf}
      openTaskId={listed}
      onOpenTask={onOpenTask}
      detail={detail}
      detailFailed={detailError != null}
      onOpenLink={onOpenLink}
      onSetStatus={canEdit ? writes.setStatus : undefined}
      onToggleSubtask={canEdit ? writes.toggleSubtask : undefined}
      onAddNote={writes.addNote}
    />
  );
}
