/**
 * `op="manage"`: the actions that ask the operator's own machine to act. Takes `args` and `client`
 * only: the server stamps the authenticated caller, so no argument here can reach another member's
 * machine; adding a parameter needs a written argument for why.
 * The `channel-` filename prefix is load-bearing for the parity and removed-vocabulary scans.
 */
import type { DoplClient } from "@dopl/client";
import { type ToolResponse } from "./respond";
import type { z } from "zod";
import type { ZodObject } from "zod";
import { CHANNEL_INPUT_SHAPE } from "./channel-schema";
import { type ManageAction } from "./channel-vocab";
/** The validated argument bag, exactly as `channel.ts`'s handler receives it. */
type ChannelArgs = z.infer<ZodObject<typeof CHANNEL_INPUT_SHAPE>>;
/** True for an action this module answers; the per-op action vocabularies are disjoint. */
export declare function isManageAction(action: string): action is ManageAction;
export declare function dispatchManageAction(action: ManageAction, args: ChannelArgs, client: DoplClient): Promise<ToolResponse>;
export {};
