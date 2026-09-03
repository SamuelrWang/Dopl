/**
 * `dopl_agent` READ op handlers: list, get. Non-mutating — they resolve a
 * template ref (or a shelf) and render it. Routed from the registrar in
 * `agent.ts`.
 */
import type { DoplClient } from "@dopl/client";
import { type ToolResponse } from "./respond.js";
import { type ShelfArg } from "./shelf.js";
export declare function opList(client: DoplClient, shelf?: ShelfArg): Promise<ToolResponse>;
export declare function opGet(client: DoplClient, ref: string, callerUserId?: string | null, 
/** A16: clip the INSTRUCTIONS body, and SAY so. */
maxChars?: number): Promise<ToolResponse>;
