/**
 * Shared resolvers + error mappers for the `dopl_kb` / `dopl_kb_admin`
 * tools. Base-reference resolution and the field-named validation-failure
 * mappers live here because the read, write, and admin op modules all lean
 * on them. The registrar (knowledge.ts) keeps op routing; these are the
 * cross-cutting internals.
 */
import type { DoplClient, KnowledgeBase } from "@dopl/client";
import { type ToolResponse } from "./respond";
/**
 * resolveBase + the standard not-found error. Returns the base, or a
 * ToolResponse error (caller short-circuits on the `isError` branch).
 */
export declare function resolveBaseOr(client: DoplClient, ref: string): Promise<KnowledgeBase | ToolResponse>;
export declare function isErr(x: KnowledgeBase | ToolResponse): x is ToolResponse;
/**
 * Clean surface for the F-10 read-only-base delete rejection. The API
 * returns 403 `AGENT_WRITE_DISABLED` when an agent tries to delete a base
 * (or anything inside it) that's flagged `agent_write_enabled=false`.
 * Surface the server's actionable message verbatim instead of a raw throw
 * or a `CODE: message` dump. Returns null otherwise so the caller rethrows.
 * Duck-typed on `.status` / `.code` to avoid importing the @dopl/client
 * error class across the module boundary (same pattern as isConflict).
 */
export declare function agentWriteDenied(e: unknown): ToolResponse | null;
/**
 * Maps a `write_file` validation failure to a tool-shaped message naming
 * the field + rule + recovery (F-18). Returns null when the error isn't a
 * recognized validation failure so the caller rethrows.
 */
export declare function writeFileValidationError(e: unknown, title?: string): ToolResponse | null;
/**
 * Maps an `update_base` validation failure to a tool-shaped message
 * naming the field + rule + recovery (F-18). Returns null when the error
 * isn't a recognized validation failure so the caller rethrows.
 */
export declare function updateBaseValidationError(e: unknown): ToolResponse | null;
