/**
 * `dopl_kb_admin` DESTRUCTIVE op handlers: delete_base, delete_folder,
 * delete_file. Deletion is permanent — there is no trash to restore from. The
 * agent-write-denied (403) mapping keeps read-only bases from throwing raw.
 * Routed from the registrar in knowledge.ts.
 *
 * UNREACHABLE since §2b: `server.ts` refuses every op on this tool before
 * dispatch (`delete-policy.ts`). Kept so the capability returns by removing the
 * gate rather than by rewriting handlers — which is also why their narration
 * has to stay honest about what a delete would actually do.
 */
import type { DoplClient } from "@dopl/client";
import { type ToolResponse } from "./respond";
export declare function opDeleteBase(client: DoplClient, ref: string): Promise<ToolResponse>;
export declare function opDeleteFolder(client: DoplClient, ref: string, path: string): Promise<ToolResponse>;
export declare function opDeleteFile(client: DoplClient, ref: string, path: string): Promise<ToolResponse>;
