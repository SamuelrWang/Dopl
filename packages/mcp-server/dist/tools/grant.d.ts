/**
 * The one place a lend is composed, for `dopl_kb(op="grant")` and `dopl_agent(op="grant")`. A grant
 * lends the ONE row (an edit reaches everyone it is lent to). The fence is the server's
 * (`src/shared/grants/service.ts`); the local ownership check only narrows an already-fenced read
 * so the refusal can name what the server's uniform 404 cannot.
 */
import { type WorkspaceDirectory } from "../workspace-directory.js";
import { type ToolResponse } from "./respond.js";
/** Scopes offered here. The table also takes `team`, deliberately not taught on MCP
 *  (`agent-team-axis.test.ts` holds that over the served strings). */
export declare const GRANT_SCOPE_VALUES: readonly ["channel", "container"];
export type GrantScopeArg = (typeof GRANT_SCOPE_VALUES)[number];
/** Two vocabularies in one enum: channel AUDIENCES (`visible`/`agent_only`, not a high/low pair) and
 *  container levels (`read`/`edit`); the pairing is checked by {@link levelForScope}, as the DB CHECK does. */
export declare const GRANT_LEVEL_VALUES: readonly ["visible", "agent_only", "read", "edit"];
export type GrantLevelArg = (typeof GRANT_LEVEL_VALUES)[number];
/** The level to send, or the refusal. An omitted level is the narrower word, never the widening one. */
export declare function levelForScope(scope: GrantScopeArg, level: GrantLevelArg | undefined): GrantLevelArg | ToolResponse;
/** Translates the server's `SCOPE_NOT_ALLOWED_IN_WORKSPACE` (channel scope is a home-channel
 *  mechanism). Not provable locally: `to` is a bare channel uuid. */
export declare function channelScopeRefusal(e: unknown): ToolResponse | null;
/** Narrow the `resolve → value | refusal` union. */
export declare function isGrantRefusal(x: unknown): x is ToolResponse;
/** You lend what you created, not what you can read. Fails closed on an unknown creator or caller. */
export declare function notOwnedRefusal(createdBy: string | null | undefined, selfUserId: string | null, noun: string, ref: string): ToolResponse | null;
/**
 * `to` → the scope id. A channel is named by id; a container goes through
 * `workspace-directory.ts › resolveContainerRef` (slug, uuid, `home`, container id; honours the
 * container lock; refuses an ambiguous slug rather than picking, F-719). Never falls back to the
 * calling workspace. Not-found stays one uniform answer (no existence oracle).
 */
export declare function resolveGrantScopeId(directory: WorkspaceDirectory, scope: GrantScopeArg, to: string): Promise<string | ToolResponse>;
/**
 * The three argument descriptions, shared by both legacy tools (the enums are published as
 * keywords); a granular tool describes its own (`granular-text.ts › SHARED_PARAMS`).
 */
export declare const GRANT_SCOPE_ARG_DESCRIPTION: string;
export declare const GRANT_TO_ARG_DESCRIPTION: string;
export declare const GRANT_LEVEL_ARG_DESCRIPTION: string;
/** The `granted` line both tools answer with. */
export declare function grantedLine(noun: string, name: string, scope: GrantScopeArg, scopeId: string, level: GrantLevelArg): ToolResponse;
