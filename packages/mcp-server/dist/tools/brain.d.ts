/**
 * `dopl_brain` — read + maintain a cluster's brain (instructions + memories).
 *
 * Consolidates the old `dopl_brain(op='get')`, `dopl_brain(op='update_instructions')`,
 * `dopl_brain(op='save_memory')`, `dopl_brain(op='update_memory')`, and `dopl_brain(op='template')`
 * tools. Follows the canonical pattern in `setups.ts`: a single `register(...)`
 * with an `op` enum + a flat schema of all per-op params (optional), a handler
 * that switches on `op`, validates required params via `missingParams`, then
 * calls the existing `client.*` method. Op bodies are lifted verbatim.
 */
import type { DoplClient } from "@dopl/client";
import { type RegisterTool } from "./respond";
export declare function registerBrainTools(register: RegisterTool, client: DoplClient): void;
