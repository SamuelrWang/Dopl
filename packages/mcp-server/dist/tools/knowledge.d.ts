/**
 * `dopl_kb` — the user's editable knowledge bases, addressed like a filesystem
 * (bases by slug or id, folders/entries by `/`-separated path): reads plus
 * non-destructive writes. ⚠ THERE IS NO DELETE OP AND NO `dopl_kb_admin`
 * (deleted 2026-09-02) — deletion is app-only, fenced by `sessionOnly` on the
 * REST routes, and `delete-policy.ts` is where that rule now lives.
 *
 * Thin registrar: one tool schema + op routing, delegating to
 *   - `knowledge-shared.ts`    — base resolution + error/validation mappers
 *   - `knowledge-ops-read.ts`  — list_bases/get_tree/list_dir/read_file/search
 *   - `knowledge-ops-write.ts` — create/update/move/write/grant ops
 */
import type { DoplClient } from "@dopl/client";
import { type CallerIdentity } from "./identity";
import { type RegisterTool } from "./respond";
import type { WorkspaceDirectory } from "../workspace-directory";
export declare function registerKnowledgeTools(register: RegisterTool, client: DoplClient, caller: CallerIdentity | undefined, directory: WorkspaceDirectory): void;
