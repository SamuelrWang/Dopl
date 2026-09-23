/**
 * `dopl_kb` listing reads: list_bases, get_tree, list_dir. outline/read_file live in `knowledge-ops-read-doc.ts`;
 * search lives in `knowledge-ops-search.ts`, and its result discloses it is a recall-capped sample, not a census.
 * Member-written names are values (`inlineOr`); summaries and headings render verbatim only inside a fence.
 */
import type { DoplClient } from "@dopl/client";
import { type ToolResponse } from "./respond";
import type { WorkspaceDirectory } from "../workspace-directory";
/** The server returns this container's bases plus the caller's personal ones; rows are grouped by container first
 *  (twin: `agent-ops-read.ts › opList`). */
export declare function opListBases(client: DoplClient, 
/** Optional: absent = not known, so no `channelId` is sent and the grant split is skipped. */
directory?: WorkspaceDirectory): Promise<ToolResponse>;
export declare function opGetTree(client: DoplClient, ref: string, entryLimit?: number, entryCursor?: string): Promise<ToolResponse>;
export declare function opListDir(client: DoplClient, ref: string, path?: string): Promise<ToolResponse>;
export { opOutline, opReadFile } from "./knowledge-ops-read-doc";
