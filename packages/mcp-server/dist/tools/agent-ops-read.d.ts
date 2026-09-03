/**
 * `dopl_agent` READ op handlers: list, get. Non-mutating — they resolve a
 * template ref (or a shelf) and render it. Routed from the registrar in
 * `agent.ts`.
 */
import type { DoplClient } from "@dopl/client";
import { type ToolResponse } from "./respond.js";
/**
 * ⚠ **THE `shelf` ARGUMENT AND ITS `· personal` LABEL LEFT ON 2026-09-02**
 * (slice B15, ruling B10) — the twin of `dopl_kb(op="list_bases")`'s, for the
 * same reason: a personal template is an ordinary row in the caller's own
 * `kind='personal'` CONTAINER, so "which shelf" is the tenancy the call is
 * already in.
 */
export declare function opList(client: DoplClient): Promise<ToolResponse>;
export declare function opGet(client: DoplClient, ref: string, callerUserId?: string | null, 
/** A16: clip the INSTRUCTIONS body, and SAY so. */
maxChars?: number): Promise<ToolResponse>;
