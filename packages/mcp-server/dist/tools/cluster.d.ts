/**
 * `dopl_cluster` + `dopl_cluster_admin` — cluster read/non-destructive writes
 * and the separately permission-gated destructive cluster operations.
 *
 * Follows the canonical consolidation pattern (see `setups.ts`): a single
 * `register(...)` per tool with an `op` enum + a flat schema of all per-op
 * params (optional at the schema level), a handler that switches on `op`,
 * validates required params for the chosen op via `missingParams`, then calls
 * a lifted op-function. Op bodies are lifted verbatim from the old per-tool
 * handlers in `server.ts` — only restructured into functions, logic and output
 * text unchanged.
 */
import type { DoplClient } from "@dopl/client";
import { type RegisterTool } from "./respond";
export declare function registerClusterTools(register: RegisterTool, client: DoplClient): void;
