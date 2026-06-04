/**
 * `dopl_canvas` — manage the user's canvas (the saved-entries workspace).
 *
 * Consolidates the old `dopl_canvas(op='list')`, `dopl_canvas(op='add_entry')`,
 * `dopl_canvas(op='remove_entry')`, `dopl_canvas(op='search_and_add')`, and `dopl_canvas(op='rename_chat')` tools.
 * Follows the canonical pattern in `setups.ts`: one `register(...)` with an
 * `op` enum + a flat schema of all per-op params (optional), a handler that
 * switches on `op`, validates required params via `missingParams`, then calls
 * a lifted op-function. Op bodies are lifted verbatim from the old handlers.
 */
import type { DoplClient } from "@dopl/client";
import { type RegisterTool } from "./respond";
export declare function registerCanvasTools(register: RegisterTool, client: DoplClient): void;
