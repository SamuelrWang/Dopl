/**
 * `dopl_workflow` READ op handlers: list, get (metadata + topo-ordered
 * steps + attachments, summary|full), step (one step's walk detail), and
 * list_trash (the recovery surface). Non-mutating. Routed from the
 * registrar in workflow.ts.
 */
import type { DoplClient } from "@dopl/client";
import { type ToolResponse } from "./respond";
export declare function opList(client: DoplClient): Promise<ToolResponse>;
export declare function opGet(client: DoplClient, slug: string, detail?: "summary" | "full"): Promise<ToolResponse>;
export declare function opStep(client: DoplClient, slug: string, stepRef: string): Promise<ToolResponse>;
export declare function opListTrash(client: DoplClient): Promise<ToolResponse>;
