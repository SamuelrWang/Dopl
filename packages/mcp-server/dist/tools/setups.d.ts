/**
 * `dopl_setups` — browse + fetch knowledge-base entries.
 *
 * Consolidates the old `dopl_setups(op='list')` + `dopl_setups(op='get')` tools. The semantic
 * front-door tools `search_setups` and `build_solution` stay standalone
 * in server.ts (high-traffic, must stay obvious to the model).
 *
 * This module is the canonical pattern for every consolidated domain tool:
 * a single `register(...)` with an `op` enum + a flat schema of all per-op
 * params (optional), a handler that switches on `op`, validates required
 * params for that op via `missingParams`, then calls the existing
 * `client.*` method. Op bodies are lifted verbatim from the old handlers.
 */
import type { DoplClient } from "@dopl/client";
import { type RegisterTool } from "./respond";
export declare function registerSetupsTools(register: RegisterTool, client: DoplClient): void;
