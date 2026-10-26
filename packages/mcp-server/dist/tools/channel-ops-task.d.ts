/**
 * `op="task"` — create, edit, assign, split, note and resolve a channel task, one POST each to
 * `/api/channels/[channelId]/tasks`. Every action answers the task as it now stands, so one renderer
 * covers all eight. There is no delete: a task that should not exist is resolved.
 */
import type { DoplClient, TaskActor } from "@dopl/client";
import type { z, ZodObject } from "zod";
import type { CHANNEL_INPUT_SHAPE } from "./channel-schema";
import { type TaskAction } from "./channel-vocab";
import { type ToolResponse } from "./respond";
import type { MemberView } from "./channel-render-identity";
/** `description` is carried by the granular tool past the legacy schema, as on the room tools. */
export type TaskArgs = z.infer<ZodObject<typeof CHANNEL_INPUT_SHAPE>> & {
    description?: string;
};
export declare function isTaskAction(action: string): action is TaskAction;
/** A task id that is not a uuid is refused here; the route would 400 without naming the field. */
export declare function taskIdRefusal(task: string | undefined, channel: string, lead: string): ToolResponse | null;
/** The route's task error codes, each with the call that recovers; null for anything else. */
export declare function taskRefusal(e: unknown, channel: string, task: string | undefined, lead: string): ToolResponse | null;
/** The handles joined when they fit one fact, else how many there are. */
export declare function assigneesFact(actors: TaskActor[], view: MemberView): string;
export declare function dispatchTaskAction(action: TaskAction, args: TaskArgs, client: DoplClient): Promise<ToolResponse>;
