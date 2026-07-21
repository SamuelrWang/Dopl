/**
 * `dopl_kb_admin` DESTRUCTIVE op handlers: delete_base, delete_folder,
 * delete_file. Every op is a soft-delete (restorable from trash). The
 * agent-write-denied (403) mapping keeps read-only bases from throwing raw.
 * Routed from the registrar in knowledge.ts.
 */
import type { DoplClient } from "@dopl/client";
import { type ToolResponse } from "./respond";
export declare function opDeleteBase(client: DoplClient, ref: string): Promise<ToolResponse>;
export declare function opDeleteFolder(client: DoplClient, ref: string, path: string): Promise<ToolResponse>;
export declare function opDeleteFile(client: DoplClient, ref: string, path: string): Promise<ToolResponse>;
