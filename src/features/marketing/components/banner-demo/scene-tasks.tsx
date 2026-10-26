"use client";

/**
 * The product tasks UI over in-memory tasks: the composer's quick view and the Tasks tab's body,
 * for a scene with no tasks route. Mounted by the hero demo and the /channels staging page.
 */

import type { ReactNode } from "react";
import { TasksPanel } from "@/features/channels/components/tasks-panel";
import { TasksQuickView } from "@/features/channels/components/tasks-quick-view";
import { useTaskFaces } from "@/features/channels/components/task-faces";
import type { AgentFeeds } from "@/features/channels/components/agent-face";
import type { AuthorIndex } from "@/features/channels/components/view-model";
import { isActiveTask } from "@/features/channels/lib/task-model";
import type { ChannelTaskDetail, TaskLink, TaskStatus } from "@/features/channels/types";

/** Every task carries its own detail; each write lands in the host's state. */
export type SceneTasks = {
  list: readonly ChannelTaskDetail[];
  onSetStatus: (taskId: string, status: TaskStatus) => void;
  onToggleSubtask: (taskId: string, subtaskId: string) => void;
  onAddNote: (taskId: string, body: string) => Promise<void>;
};

type SceneTaskSlots = {
  /** `ChannelsMessagePane › tasksQuickView`. */
  quickView: ReactNode;
  /** `ChannelsInfoPanel › tasks`; `undefined` draws no Tasks tab. */
  panel: ReactNode | undefined;
  activeTaskCount: number | undefined;
};

export function useSceneTaskSlots({
  tasks,
  index,
  feeds,
  openTaskId,
  onSelectTask,
  onOpenTask,
  onOpenLink,
  defaultResolvedOpen,
}: {
  /** Absent draws no tasks UI. */
  tasks: SceneTasks | undefined;
  index: AuthorIndex;
  feeds: AgentFeeds;
  openTaskId: string | null;
  /** Inside the tab: a row opens its detail, the crumb returns to the list. */
  onSelectTask: (taskId: string | null) => void;
  /** From the quick view: open the Tasks tab, on a task's detail or the list. */
  onOpenTask: (taskId: string | null) => void;
  onOpenLink: (link: TaskLink) => void;
  defaultResolvedOpen?: boolean;
}): SceneTaskSlots {
  const faceOf = useTaskFaces(index, feeds);
  if (!tasks) return { quickView: null, panel: undefined, activeTaskCount: undefined };
  const { list } = tasks;
  return {
    quickView: <TasksQuickView tasks={list} faceOf={faceOf} onOpenTask={onOpenTask} />,
    panel: (
      <TasksPanel
        tasks={list}
        faceOf={faceOf}
        defaultResolvedOpen={defaultResolvedOpen}
        openTaskId={openTaskId}
        onOpenTask={onSelectTask}
        detail={list.find((t) => t.id === openTaskId) ?? null}
        onOpenLink={onOpenLink}
        onSetStatus={(t, status) => tasks.onSetStatus(t.id, status)}
        onToggleSubtask={(t, sub) => tasks.onToggleSubtask(t.id, sub.id)}
        onAddNote={tasks.onAddNote}
      />
    ),
    activeTaskCount: list.filter(isActiveTask).length,
  };
}
