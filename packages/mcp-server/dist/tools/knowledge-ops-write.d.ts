/**
 * `dopl_kb` non-destructive WRITE op handlers: create/update/set_visibility
 * on bases, create/move folders, write/move entries, and the restore
 * (recovery) ops. Every write maps @dopl/client errors — conflict (412),
 * already-exists (409), agent-write-denied (403), and validation (400) —
 * to actionable tool messages. Routed from the registrar in knowledge.ts.
 */
import type { DoplClient } from "@dopl/client";
import { type ToolResponse } from "./respond";
export declare function opCreateBase(client: DoplClient, name: string, description?: string): Promise<ToolResponse>;
export declare function opUpdateBase(client: DoplClient, ref: string, name?: string, description?: string | null, slug?: string): Promise<ToolResponse>;
export declare function opSetVisibility(client: DoplClient, ref: string, visibility: string): Promise<ToolResponse>;
export declare function opRestoreBase(client: DoplClient, ref: string): Promise<ToolResponse>;
export declare function opCreateFolder(client: DoplClient, ref: string, path: string, description?: string): Promise<ToolResponse>;
export declare function opMoveFolder(client: DoplClient, ref: string, from_path: string, to_path: string): Promise<ToolResponse>;
export declare function opWriteFile(client: DoplClient, ref: string, path: string, body: string, title?: string, expected_version?: string, force?: boolean, excerpt?: string): Promise<ToolResponse>;
export declare function opMoveFile(client: DoplClient, ref: string, from_path: string, to_path: string): Promise<ToolResponse>;
export declare function opRestoreFolder(client: DoplClient, folder_id: string): Promise<ToolResponse>;
export declare function opRestoreFile(client: DoplClient, entry_id: string): Promise<ToolResponse>;
