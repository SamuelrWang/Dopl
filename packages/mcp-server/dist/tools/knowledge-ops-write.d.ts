/**
 * `dopl_kb` TREE writes — folders and entries inside a base: create a folder,
 * move a folder or an entry, write an entry. Routed from the registrar in
 * `knowledge.ts`.
 *
 * ⚠ **THE BASE OPS LEFT ON 2026-09-18 (A3)** for
 * `knowledge-ops-write-bases.ts`, which carries the seam's argument: a base is
 * a container with an AUDIENCE, a folder or an entry is a PATH inside one whose
 * audience is already settled. This file was at §1's 500-line hard cap, so the
 * split came before the edit. The base ops are re-exported below, so no
 * importer moved.
 *
 * ⚠ Errors map as they always did — conflict (412), already-exists (409),
 * agent-write-denied (403), validation (400) — and anything unmapped rethrows.
 */
import type { DoplClient } from "@dopl/client";
import { type ToolResponse } from "./respond";
export { opCreateBase, opGrantBase, opSetVisibility, opUpdateBase, } from "./knowledge-ops-write-bases";
export declare function opCreateFolder(client: DoplClient, ref: string, path: string, description?: string): Promise<ToolResponse>;
/**
 * `move_folder` and `move_file` — ONE mover (2026-09-17). They were two
 * functions differing only in a noun: `moveKbByPath` is path-addressed and
 * kind-agnostic, so the only per-op logic is checking that the path resolved to
 * the KIND the caller named — which is a refusal, because moving an entry on a
 * `move_folder` would be a write the caller never asked for.
 */
export declare function opMove(client: DoplClient, ref: string, from_path: string, to_path: string, kind: "folder" | "entry"): Promise<ToolResponse>;
/**
 * ⚠ **`section` MAKES THIS A READ-MODIFY-WRITE, AND THE SERVER DOES ALL THREE.**
 * The splice happens against the row `expected_version` was just checked on, so
 * a sectioned write is exactly as safe as a whole-body one — where a caller
 * merging locally would be merging onto a body it fetched in an earlier request.
 *
 * ⚠ **THE RESULT ALWAYS ENDS WITH THE OUTLINE OF WHAT WAS SAVED**, which is the
 * addresses the next read can use, and it LEADS with `reason=UNSECTIONED` when a
 * long body carries no headings at all. **The write lands either way** (Samuel's
 * ruling): refusing would refuse the user's content over our formatting taste.
 */
export declare function opWriteFile(client: DoplClient, ref: string, path: string, body: string, title?: string, expected_version?: string, force?: boolean, excerpt?: string, section?: string): Promise<ToolResponse>;
