/**
 * `dopl_ingest` — the agent-driven ingest pipeline + supporting reads.
 *
 * Consolidates the old `dopl_ingest(op='url')`, `dopl_ingest(op='content')`, `dopl_ingest(op='describe_link')`,
 * `dopl_ingest(op='pending')`, `dopl_ingest(op='submit')`, and (admin-only)
 * `dopl_ingest(op='skeleton')` tools. Follows the canonical pattern in `setups.ts`: one
 * `register(...)` with an `op` enum + a flat schema of all per-op params
 * (optional), a handler that switches on `op`, validates required params via
 * `missingParams`, then calls a lifted op-function. Op bodies are lifted
 * verbatim from the old handlers.
 *
 * The long, instruction-bearing descriptions of the old `dopl_ingest(op='url')` and
 * `dopl_ingest(op='submit')` tools are preserved on the op="url" / op="submit"
 * lines below — they drive the multi-step agent ingest flow and must not be
 * trimmed.
 */
import type { DoplClient } from "@dopl/client";
import { type RegisterTool } from "./respond";
export declare function registerIngestTools(register: RegisterTool, client: DoplClient, isAdmin: boolean): void;
