"use client";

import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useApiQuery } from "@/shared/hooks/use-api-query";
import { channelKeys, channelTasksPath } from "../client/query-keys";
import type { ChannelTask, ChannelTaskDetail, ChannelTaskPage } from "../types";

/** Stable identity for the not-yet-loaded case (a fresh [] would churn memos). */
const NO_TASKS: ChannelTask[] = [];

/**
 * The channel's tasks, in server order (`updated_at` descending); `null` asks for nothing.
 * `truncated` is carried through (INVARIANTS §9), and `error` keeps a failed read distinct from an
 * empty one. `refetch` invalidates the whole path, so an open detail re-reads on the same doorbell
 * as the list.
 */
export function useChannelTasks(channelId: string | null, workspaceId: string) {
  const client = useQueryClient();
  const query = useApiQuery<ChannelTaskPage>(
    channelId ? channelTasksPath(channelId) : null,
    { workspaceId }
  );
  const refetch = useCallback(() => {
    if (channelId) {
      void client.invalidateQueries({ queryKey: channelKeys.tasks(channelId).all });
    }
  }, [client, channelId]);
  return {
    tasks: query.data?.tasks ?? NO_TASKS,
    truncated: query.data?.truncated === true,
    loading: query.isLoading,
    error: query.error,
    refetch,
  };
}

/** ONE task with its subtasks and notes; read only while its detail is open. */
export function useChannelTask(
  channelId: string | null,
  taskId: string | null,
  workspaceId: string
) {
  const query = useApiQuery<{ task: ChannelTaskDetail }>(
    channelId && taskId ? channelTasksPath(channelId) : null,
    { workspaceId, query: taskId ? { task: taskId } : undefined }
  );
  return {
    task: query.data?.task ?? null,
    loading: query.isLoading,
    error: query.error,
  };
}
