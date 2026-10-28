/**
 * `op="rooms" action="tasks"` — a channel's tasks, or one task whole (`task=<id>`): subtasks,
 * assignees and notes. Titles are inline values; descriptions and notes are bodies, fenced.
 */
import type { DoplClient } from "@dopl/client";
import { type ToolResponse } from "./respond";
export declare function opReadTasks(client: DoplClient, ref: string, taskId: string | undefined): Promise<ToolResponse>;
