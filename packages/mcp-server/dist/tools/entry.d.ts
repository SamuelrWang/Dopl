/**
 * `dopl_entry` — edit + freshness-check knowledge-base entries.
 *
 * Consolidates the old `dopl_entry(op='update')`, `dopl_entry(op='check_updates')`, and
 * `dopl_entry(op='check_cluster_updates')` tools. Follows the canonical pattern in
 * `setups.ts`: a single `register(...)` with an `op` enum + a flat schema
 * of all per-op params (optional), a handler that switches on `op`,
 * validates required params via `missingParams`, then calls the existing
 * `client.*` method. Op bodies are lifted verbatim.
 */
import type { DoplClient } from "@dopl/client";
import { type RegisterTool } from "./respond";
export declare function registerEntryTools(register: RegisterTool, client: DoplClient): void;
