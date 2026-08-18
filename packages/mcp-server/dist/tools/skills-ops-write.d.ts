/**
 * `dopl_skill` WRITE op handlers plus `dopl_skill_admin`'s delete. ⚠ Every one
 * can come back 403 `SKILL_AGENT_WRITE_DISABLED`, which is why
 * `agentWriteDenied` lives beside `failureDetail` in `skills-shared.ts`.
 */
import type { DoplClient } from "@dopl/client";
import { type ToolResponse } from "./respond";
export declare function opWrite(client: DoplClient, slug: string, body: string, expected_version?: string, force?: boolean): Promise<ToolResponse>;
export declare function opCreate(client: DoplClient, params: {
    name?: string;
    description?: string;
    when_to_use?: string;
    when_not_to_use?: string | null;
    slug?: string;
    status?: "active" | "draft";
    agent_write_enabled?: boolean;
    folder?: string | null;
    body?: string;
}): Promise<ToolResponse>;
export declare function opUpdate(client: DoplClient, params: {
    slug?: string;
    name?: string;
    description?: string;
    when_to_use?: string;
    when_not_to_use?: string | null;
    new_slug?: string;
    status?: "active" | "draft";
    agent_write_enabled?: boolean;
    folder?: string | null;
}): Promise<ToolResponse>;
export declare function opSetVisibility(client: DoplClient, slug: string, visibility: string): Promise<ToolResponse>;
export declare function opDelete(client: DoplClient, slug: string): Promise<ToolResponse>;
