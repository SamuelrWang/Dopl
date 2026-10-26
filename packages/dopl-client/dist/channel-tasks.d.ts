/** Channel tasks over `/api/channels/[channelId]/tasks`. There is no delete; status moves through `set_status`. */
import type { DoplTransport } from "./transport.js";
import type { ChannelTaskAction, ChannelTaskDetail, ChannelTaskPage, ChannelTaskWriteResult, TaskStatus } from "./channel-task-types.js";
/** ⚠ `truncated` says the page hit the server's ceiling; never drop it. */
export declare function listTasks(t: DoplTransport, channelId: string, opts?: {
    status?: TaskStatus;
}): Promise<ChannelTaskPage>;
export declare function readTask(t: DoplTransport, channelId: string, taskId: string): Promise<ChannelTaskDetail>;
/** Every action answers the task as it now stands. */
export declare function writeTask(t: DoplTransport, channelId: string, input: ChannelTaskAction): Promise<ChannelTaskWriteResult>;
