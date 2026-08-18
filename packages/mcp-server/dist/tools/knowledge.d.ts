/**
 * `dopl_kb` + `dopl_kb_admin` — the user's editable knowledge bases, addressed
 * like a filesystem (bases by slug or id, folders/entries by `/`-separated
 * path). `dopl_kb` = read + non-destructive writes; ⚠ `dopl_kb_admin` is the
 * delete surface and REFUSES every op it publishes.
 *
 * Thin registrar: two tool schemas + op routing, delegating to
 *   - `knowledge-shared.ts`    — base resolution + error/validation mappers
 *   - `knowledge-ops-read.ts`  — list_bases/get_tree/list_dir/read_file/search
 *   - `knowledge-ops-write.ts` — create/update/move/write ops
 *   - `knowledge-ops-admin.ts` — the (refused) delete ops
 */
import type { DoplClient } from "@dopl/client";
import { type CallerIdentity } from "./identity";
import { type RegisterTool } from "./respond";
export declare function registerKnowledgeTools(register: RegisterTool, client: DoplClient, caller?: CallerIdentity): void;
