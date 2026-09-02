/**
 * MCP tools for the chat archive. Chats are agent-exported conversation
 * records: per-message summaries under an agent-filled session header. Private
 * to their owner by default; the owner can share one with the workspace.
 * ⚠ ONE TOOL: reads + non-destructive writes. There is no delete op and no
 * `dopl_chats_admin` (deleted 2026-09-02) — deletion is app-only and permanent,
 * fenced by `sessionOnly` on the two chat DELETE routes.
 */
import type { DoplClient } from "@dopl/client";
import { type RegisterTool } from "./respond";
export declare function registerChatTools(register: RegisterTool, client: DoplClient): void;
