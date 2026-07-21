/**
 * `dopl_kb` + `dopl_kb_admin` — the user's editable knowledge bases (Item 4).
 *
 * Consolidates the old 18 `kb_*` tools into two `op`-dispatched tools (the
 * canonical consolidated pattern — see setups.ts). The agent talks to these
 * like a filesystem; bases are addressed by slug or id, folders/entries by
 * `/`-separated path. `dopl_kb` = read + non-destructive writes (restores are
 * recovery, not deletion); `dopl_kb_admin` = the destructive soft-deletes,
 * broken out so the model can't reach them without the destructive surface.
 *
 * These expose the user's OWN editable bases (create / edit / soft-delete),
 * addressed like a filesystem.
 *
 * This file is the thin registrar: it owns the two tool schemas + op
 * routing and delegates each op to a handler in a sibling module —
 *   - `knowledge-shared.ts`    — base resolution + error/validation mappers
 *   - `knowledge-ops-read.ts`  — list_bases/get_tree/list_dir/read_file/list_trash/search
 *   - `knowledge-ops-write.ts` — create/update/move/write + restore (recovery) ops
 *   - `knowledge-ops-admin.ts` — the destructive soft-deletes
 */
import type { DoplClient } from "@dopl/client";
import { type RegisterTool } from "./respond";
export declare function registerKnowledgeTools(register: RegisterTool, client: DoplClient): void;
