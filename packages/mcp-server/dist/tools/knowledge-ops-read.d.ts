/**
 * `dopl_kb` READ op handlers: list_bases, get_tree, list_dir, read_file,
 * search. All non-mutating — they resolve a base (or the
 * workspace) and render metadata / bodies for the agent. Routed from the
 * registrar in knowledge.ts.
 */
import type { DoplClient } from "@dopl/client";
import { type ToolResponse } from "./respond";
export declare function opListBases(client: DoplClient): Promise<ToolResponse>;
export declare function opGetTree(client: DoplClient, ref: string, entryLimit?: number, entryCursor?: string): Promise<ToolResponse>;
export declare function opListDir(client: DoplClient, ref: string, path?: string): Promise<ToolResponse>;
export declare function opReadFile(client: DoplClient, ref: string, path: string, callerUserId?: string | null): Promise<ToolResponse>;
export declare function opSearch(client: DoplClient, query: string, base?: string, limit?: number): Promise<ToolResponse>;
