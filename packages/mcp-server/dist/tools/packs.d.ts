/**
 * `dopl_packs` — Dopl's curated, READ-ONLY knowledge packs (specialist
 * verticals backed by public GitHub repos). Distinct from the user's own
 * knowledge bases (those live in the `kb_*` user-KB tools).
 *
 * Consolidates the old `dopl_packs(op='list')`, `dopl_packs(op='list_files')`, and `dopl_packs(op='get_file')` tools.
 * Follows the canonical pattern in `setups.ts`: one `register(...)` with an
 * `op` enum + a flat schema of all per-op params (optional), a handler that
 * switches on `op`, validates required params via `missingParams`, then calls
 * a lifted op-function. Op bodies are lifted verbatim from the old handlers.
 */
import type { DoplClient } from "@dopl/client";
import { type RegisterTool } from "./respond";
export declare function registerPacksTools(register: RegisterTool, client: DoplClient): void;
