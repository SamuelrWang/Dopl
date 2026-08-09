/**
 * `dopl_kb` + `dopl_kb_admin` — the user's editable knowledge bases (Item 4).
 *
 * Consolidates the old 18 `kb_*` tools into two `op`-dispatched tools (the
 * canonical consolidated pattern — see setups.ts). The agent talks to these
 * like a filesystem; bases are addressed by slug or id, folders/entries by
 * `/`-separated path. `dopl_kb` = read + non-destructive writes;
 * `dopl_kb_admin` = the delete surface, which since the §2b app-only-deletion
 * decision REFUSES every op it publishes.
 *
 * These expose the user's OWN editable bases (create / edit), addressed like a
 * filesystem.
 *
 * This file is the thin registrar: it owns the two tool schemas + op
 * routing and delegates each op to a handler in a sibling module —
 *   - `knowledge-shared.ts`    — base resolution + error/validation mappers
 *   - `knowledge-ops-read.ts`  — list_bases/get_tree/list_dir/read_file/search
 *   - `knowledge-ops-write.ts` — create/update/move/write ops
 *   - `knowledge-ops-admin.ts` — the (now refused) delete ops
 */
import type { DoplClient } from "@dopl/client";
import { type CallerIdentity } from "./identity";
import { type RegisterTool } from "./respond";
export declare function registerKnowledgeTools(register: RegisterTool, client: DoplClient, caller?: CallerIdentity): void;
