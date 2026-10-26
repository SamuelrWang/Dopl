/**
 * `op="send"` routed to its lane: a display, a thread open, a milestone, a decision card, a record
 * or a plain post. `channel.ts` registers the tool; this file owns which handler a send reaches.
 *
 * ⚠ THREE LANES, ONE OP, AND THE `kind` IS FIXED AT THIS SEAM rather
 * than left to the caller's spelling. `milestone` stores
 * `thread_progress`; `decision` MUST stay `kind='message'` or
 * `dopl-desktop-app/main/targeting.js › classify` drops the card and the
 * human it asks is never notified. Both delegate to `opPost` rather than
 * growing a second delivery path.
 */
import type { DoplClient } from "@dopl/client";
import type { z, ZodObject } from "zod";
import { type ToolResponse } from "./respond";
import type { CHANNEL_INPUT_SHAPE } from "./channel-schema";
type ChannelArgs = z.infer<ZodObject<typeof CHANNEL_INPUT_SHAPE>>;
export declare function routeSend(client: DoplClient, args: ChannelArgs, runtime: string | null): Promise<ToolResponse>;
export {};
