/**
 * `dopl_kb` base writes (create, update, publish); the tree inside a base is `knowledge-ops-write.ts`.
 * Errors map to actionable messages — 403 agent-write-denied, 400 validation/unshared/unacknowledged here, 412/409 in
 * the tree writes — and anything unmapped rethrows. Confirmations read back the STORED value and neutralize it.
 */
import type { DoplClient } from "@dopl/client";
import { type ToolResponse } from "./respond";
import type { WorkspaceDirectory } from "../workspace-directory";
/** The confirm gate (a tripwire, `confirm-token.ts`) fires only for `public` inside a shared container — any
 *  container with a second member, whatever its kind. */
export declare function opCreateBase(client: DoplClient, callerUserId: string | null, input: {
    name: string;
    description?: string;
    visibility?: "public" | "private";
    confirm_token?: string;
    /** Idempotency key, passed through: the server returns the first base rather than minting a second. */
    client_write_id?: string;
}, 
/** Optional: absent = not known, so the create goes out unshared and the server refuses it in a home channel. */
directory?: WorkspaceDirectory): Promise<ToolResponse>;
export declare function opUpdateBase(client: DoplClient, ref: string, name?: string, description?: string | null, slug?: string): Promise<ToolResponse>;
/** Publishes a base, previewing and confirming as `create_base` does (F-441). The 400 mapping is not dead code: the
 *  server's predicate (`shared-publish.ts`) is the authority and can refuse on facts this process cannot see. */
export declare function opSetVisibility(client: DoplClient, callerUserId: string | null, ref: string, visibility: string, confirmToken?: string): Promise<ToolResponse>;
