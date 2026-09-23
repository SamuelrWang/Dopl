/** `dopl_agent` read ops: list, get. Non-mutating — they resolve an identity ref and render it. */
import type { DoplClient } from "@dopl/client";
import { type ToolResponse } from "./respond.js";
import type { WorkspaceDirectory } from "../workspace-directory.js";
/** op="list": groups by container first (personal rows via `homeScopedIdentityIds`), visibility second. */
export declare function opList(client: DoplClient, 
/** Optional: absent means "not known" — falls back to the workspace visibility headings. */
directory?: WorkspaceDirectory): Promise<ToolResponse>;
export declare function opGet(client: DoplClient, ref: string, callerUserId?: string | null, 
/** Clips the INSTRUCTIONS body, and says so. */
maxChars?: number): Promise<ToolResponse>;
