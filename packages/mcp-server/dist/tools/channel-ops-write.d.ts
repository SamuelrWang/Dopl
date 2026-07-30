/**
 * `dopl_channel` WRITE op handlers: open (create a channel or direct message),
 * invite (add a workspace member), post (send a message or activity event),
 * and the first-class thread ops (create_thread / close_thread /
 * set_thread_mode). Maps @dopl/client 4xx collisions to actionable messages.
 * Routed from the registrar in channel.ts.
 *
 * BOUNDARY: the wire/storage name `task` == the domain name `thread`. The
 * `thread` op param folds into `metadata.taskId` and the `task_*` message
 * kinds keep their stored names; only the agent-facing surface says `thread`.
 */
import type { ChannelMessageInput, ChannelVisibility, DoplClient, ThreadMode, ThreadOutcome } from "@dopl/client";
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
    /** A thread id — threads this post under that thread's card (server-validated). */
    thread?: string;
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
export declare function opCreateThread(client: DoplClient, channelRef: string, title: string, body: string, to: string, mode?: ThreadMode, clientMsgId?: string): Promise<ToolResponse>;
export declare function opCloseThread(client: DoplClient, channelRef: string, threadId: string, outcome: ThreadOutcome, summary?: string): Promise<ToolResponse>;
export declare function opSetThreadMode(client: DoplClient, channelRef: string, threadId: string, mode: ThreadMode): Promise<ToolResponse>;
export {};
