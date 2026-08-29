/**
 * `dopl_kb` READ op handlers: list_bases, get_tree, list_dir, read_file,
 * search. All non-mutating — they resolve a base (or the
 * workspace) and render metadata / bodies for the agent. Routed from the
 * registrar in knowledge.ts.
 */
import type { DoplClient, KbShelf } from "@dopl/client";
import { type ToolResponse } from "./respond";
/**
 * ⚠ `shelf` ABSENT LISTS BOTH SHELVES, and that is the RIGHT answer rather than
 * an oversight (F-342 rules the unfiltered MCP read right and says it "must stay
 * right"): an operator's agent asking "what knowledge is here" should see the
 * operator's whole workspace. The narrowing is a server-side `WHERE`, so a shelf
 * the caller did not ask for never reaches the wire.
 */
export declare function opListBases(client: DoplClient, shelf?: KbShelf): Promise<ToolResponse>;
export declare function opGetTree(client: DoplClient, ref: string, entryLimit?: number, entryCursor?: string): Promise<ToolResponse>;
export declare function opListDir(client: DoplClient, ref: string, path?: string): Promise<ToolResponse>;
export declare function opReadFile(client: DoplClient, ref: string, path: string, callerUserId?: string | null): Promise<ToolResponse>;
export declare function opSearch(client: DoplClient, query: string, base?: string, limit?: number): Promise<ToolResponse>;
