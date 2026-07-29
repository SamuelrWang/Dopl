/**
 * `dopl_channel` WRITE op handlers: open (create a channel or direct message),
 * invite (add a workspace member), post (send a message or task-activity
 * event), and the first-class task ops (create_task / close_task /
 * set_task_mode). Maps @dopl/client 4xx collisions to actionable messages.
 * Routed from the registrar in channel.ts.
 */
import type { ChannelMessageInput, ChannelVisibility, DoplClient, TaskMode, TaskOutcome } from "@dopl/client";
import { type ToolResponse } from "./respond";
/** Options accepted by opPost — the per-post flags routed from the registrar. */
interface PostOptions {
    kind?: ChannelMessageInput["kind"];
    metadata?: Record<string, unknown>;
    clientMsgId?: string;
    /** Address the post to one member (email or user id, resolved like invite). */
    to?: string;
    /** One-line intent for the receiver's notification. */
    summary?: string;
    /** A task id — threads this post under that task's card (server-validated). */
    task?: string;
}
/** Options for opOpen — a normal channel, or a `direct` message with `member`. */
interface OpenOptions {
    direct?: boolean;
    member?: string;
    name?: string;
    topic?: string;
    visibility?: ChannelVisibility;
}
export declare function opOpen(client: DoplClient, opts: OpenOptions): Promise<ToolResponse>;
export declare function opInvite(client: DoplClient, channelRef: string, memberRef: string): Promise<ToolResponse>;
export declare function opPost(client: DoplClient, channelRef: string, body: string, opts?: PostOptions): Promise<ToolResponse>;
export declare function opCreateTask(client: DoplClient, channelRef: string, title: string, body: string, to: string, mode?: TaskMode, clientMsgId?: string): Promise<ToolResponse>;
export declare function opCloseTask(client: DoplClient, channelRef: string, taskId: string, outcome: TaskOutcome, summary?: string): Promise<ToolResponse>;
export declare function opSetTaskMode(client: DoplClient, channelRef: string, taskId: string, mode: TaskMode): Promise<ToolResponse>;
export {};
