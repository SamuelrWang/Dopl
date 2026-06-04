/**
 * MCP tools for connecting third-party services (Notion, Gmail,
 * Drive, etc.) and pulling content from them into the user's Dopl
 * workspace as fully-synthesized entries.
 *
 * Consolidated into ONE `op`-dispatched tool, `dopl_integration` (the
 * canonical pattern from `setups.ts`). These are connector ops — no
 * destructive split is needed. The op surface:
 *   - connect      — start (or check) the OAuth flow
 *   - status       — re-poll connection state
 *   - list_my      — every connected account across providers, in one call
 *   - list_objects — search/enumerate the connected service
 *   - read_object  — fetch one object's body content (read-only; no entry row)
 *   - list_actions — discover a provider's write actions + param schemas
 *   - execute_action — run a named write action (side-effecting)
 *   - ingest       — fetch one object → prepare-shaped bundle; agent then
 *                    calls existing `dopl_ingest(op='submit')`.
 *
 * Branding note: tool descriptions never mention the OAuth broker we
 * use under the hood. The agent only sees a Dopl-branded auth URL.
 */
import type { DoplClient } from "@dopl/client";
import { type RegisterTool } from "./respond";
export declare function registerIntegrationTools(register: RegisterTool, client: DoplClient): void;
