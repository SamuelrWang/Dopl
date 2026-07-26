/**
 * `dopl_channel` WRITE op handlers: open (create a channel), invite (add a
 * workspace member), post (send a message or task-activity event). Maps
 * @dopl/client already-exists (409) collisions to actionable messages.
 * Routed from the registrar in channel.ts.
 */
import type { ChannelMessageInput, ChannelVisibility, DoplClient } from "@dopl/client";
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
}
export declare function opOpen(client: DoplClient, name: string, topic?: string, visibility?: ChannelVisibility): Promise<ToolResponse>;
export declare function opInvite(client: DoplClient, channelRef: string, memberRef: string): Promise<ToolResponse>;
export declare function opPost(client: DoplClient, channelRef: string, body: string, opts?: PostOptions): Promise<ToolResponse>;
export {};
