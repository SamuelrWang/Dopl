/**
 * `dopl_skill` WRITE op handlers. ⚠ Every one can come back 403
 * `SKILL_AGENT_WRITE_DISABLED`, which is why `agentWriteDenied` lives beside
 * `failureDetail` in `skills-shared.ts`.
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
/**
 * 🔒 **THE PUBLISH DOOR FOR SKILLS (G16, closed 2026-09-02).** `dopl_kb` and
 * `dopl_agent` have previewed this act since A11/F-441 and this op did not, so
 * a skill was the one resource an agent could publish into a peer's container
 * with nothing in front of it and nothing on the server behind it.
 *
 * ⚠ **UN-PUBLISHING IS NOT GATED AND MUST NOT BE.** `visibility="private"` only
 * ever narrows an audience; a preview there would ask the operator to confirm
 * the safe direction, which is how a confirm step stops being read.
 */
export declare function opSetVisibility(client: DoplClient, callerUserId: string | null, slug: string, visibility: string, confirmToken?: string): Promise<ToolResponse>;
