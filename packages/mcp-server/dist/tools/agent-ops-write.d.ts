/**
 * `dopl_agent` write ops: create, update, grant.
 * The confirm gate is a tripwire (`confirm-token.ts`); the fence is the server's shared-publish check, fed by `acknowledgeShared`.
 */
import type { DoplClient, IdentityField } from "@dopl/client";
import type { WorkspaceDirectory } from "../workspace-directory.js";
import { type GrantLevelArg, type GrantScopeArg } from "./grant.js";
import { type ToolResponse } from "./respond.js";
import { type OfferedIdentityVisibility } from "./agent-shared.js";
export interface IdentityWriteInput {
    name?: string;
    description?: string | null;
    instructions?: string | null;
    model?: string | null;
    runtime?: string | null;
    fields?: IdentityField[];
    visibility?: OfferedIdentityVisibility;
    knowledge_bases?: string[];
    knowledge?: Array<{
        base: string;
        folder?: string;
        entry?: string;
    }>;
    confirm_token?: string;
    /** op="update" only — the Version from `op="get"`. */
    expected_version?: string;
    /** op="update" only — skip the version check. */
    force?: boolean;
}
export declare function opCreate(client: DoplClient, callerUserId: string | null, input: IdentityWriteInput & {
    name: string;
}, 
/** Optional: absent means "not known" and leaves the refusal to the server. */
directory?: WorkspaceDirectory): Promise<ToolResponse>;
export declare function opUpdate(client: DoplClient, callerUserId: string | null, ref: string, input: IdentityWriteInput): Promise<ToolResponse>;
/**
 * op="grant": lend one identity to a channel, container or team — one `resource_grants` row, so an edit reaches every grantee.
 * `visibility` says who inside this container may use it; a grant lends it to a scope elsewhere.
 */
export declare function opGrantIdentity(client: DoplClient, directory: WorkspaceDirectory, selfUserId: string | null, ref: string, scope: GrantScopeArg, to: string, level: GrantLevelArg | undefined): Promise<ToolResponse>;
