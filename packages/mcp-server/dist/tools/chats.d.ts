/**
 * MCP tools for the chat archive.
 *
 * Chats are agent-exported conversation records: per-message summaries
 * under an agent-filled session header (what was done, learnings).
 * Private to their owner by default; the owner can share one with the
 * workspace. Consolidated into two `op`-dispatched tools:
 *   - `dopl_chats`       — reads + non-destructive writes.
 *   - `dopl_chats_admin` — DESTRUCTIVE delete, split out on purpose.
 */
import type { DoplClient } from "@dopl/client";
import { type RegisterTool } from "./respond";
export declare function registerChatTools(register: RegisterTool, client: DoplClient): void;
