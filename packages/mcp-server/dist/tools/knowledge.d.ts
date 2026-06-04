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
 * Distinct from the read-only knowledge-pack tools (`dopl_packs(op='list')`,
 * `dopl_packs(op='list_files')`, `dopl_packs(op='get_file')`) in server.ts: those expose Dopl's own curated
 * specialist verticals; these expose the user's own editable bases.
 */
import type { DoplClient } from "@dopl/client";
import { type RegisterTool } from "./respond";
export declare function registerKnowledgeTools(register: RegisterTool, client: DoplClient): void;
