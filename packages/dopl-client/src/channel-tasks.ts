/** Channel tasks over `/api/channels/[channelId]/tasks`. There is no delete; status moves through `set_status`. */

import type { DoplTransport } from "./transport.js";
import type {
  ChannelTaskAction,
  ChannelTaskDetail,
  ChannelTaskPage,
  ChannelTaskWriteResult,
  TaskStatus,
} from "./channel-task-types.js";

const enc = encodeURIComponent;

/** ⚠ `truncated` says the page hit the server's ceiling; never drop it. */
export async function listTasks(
  t: DoplTransport,
  channelId: string,
  opts: { status?: TaskStatus } = {}
): Promise<ChannelTaskPage> {
  const qs = opts.status ? `?status=${enc(opts.status)}` : "";
  return t.request<ChannelTaskPage>(`/api/channels/${enc(channelId)}/tasks${qs}`, {
    toolName: "channel_task_list",
  });
}

export async function readTask(
  t: DoplTransport,
  channelId: string,
  taskId: string
): Promise<ChannelTaskDetail> {
  const data = await t.request<{ task: ChannelTaskDetail }>(
    `/api/channels/${enc(channelId)}/tasks?task=${enc(taskId)}`,
    { toolName: "channel_task_read" }
  );
  return data.task;
}

/** Every action answers the task as it now stands. */
export async function writeTask(
  t: DoplTransport,
  channelId: string,
  input: ChannelTaskAction
): Promise<ChannelTaskWriteResult> {
  return t.request<ChannelTaskWriteResult>(`/api/channels/${enc(channelId)}/tasks`, {
    method: "POST",
    body: input,
    toolName: "channel_task",
  });
}
