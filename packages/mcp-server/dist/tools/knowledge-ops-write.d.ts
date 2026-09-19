/**
 * `dopl_kb` TREE writes — what lives INSIDE a base: create a folder, move a
 * folder or an entry, write an entry, and the AUTHORING RULES those entries
 * owe. Routed from the registrar in `knowledge.ts`.
 *
 * ⚠ **THE BASE OPS LEFT ON 2026-09-18 (A3)** for
 * `knowledge-ops-base-writes.ts`, which carries the seam's argument: a base is
 * a container with an AUDIENCE, a folder or an entry is a PATH inside one whose
 * audience is already settled. This file was at §1's 500-line hard cap, so the
 * split came before the edit. The base ops are re-exported below, so no
 * importer moved. ⚠ The GRANT went further out still, to
 * `knowledge-ops-grant.ts`: it writes no base content, it lends one.
 *
 * ⚠ **AND THE AUTHORING RULES THEMSELVES LIVE IN `knowledge-write-rules.ts`**,
 * which is where the predicates and the refusal sentences are; this file
 * decides WHEN to ask them.
 *
 * ⚠ Errors map as they always did — conflict (412), already-exists (409),
 * agent-write-denied (403), validation (400) — and anything unmapped rethrows.
 */
import type { DoplClient } from "@dopl/client";
import { type ToolResponse } from "./respond";
export { opCreateBase, opSetVisibility, opUpdateBase, } from "./knowledge-ops-base-writes";
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
 * 🔒 **THE AUTHORING RULES RUN BEFORE THE WRITE, AND TWO OF THEM REFUSE IT**
 * (Samuel's ruling 2026-09-18, option A). An agent save with no real summary,
 * and a long body with no `##` headings, are REFUSED — *"saves should be
 * blocked if there's no description"*. A human typing in the app is never
 * blocked: that half of the ruling lives in the editor, and nothing on this
 * surface can reach a person. The two remaining rules — a pointer that names no
 * path, and a buried supersession marker — are nudges on a landed write.
 *
 * ⚠ **THE RESULT STILL ALWAYS ENDS WITH THE OUTLINE OF WHAT WAS SAVED**, which
 * is the addresses the next read can use. `unsectionedNudge` survives for the
 * `section=` path alone, where the merged body is the server's and a pre-write
 * length test would measure the wrong document.
 */
export declare function opWriteFile(client: DoplClient, ref: string, path: string, body: string, title?: string, expected_version?: string, force?: boolean, excerpt?: string, section?: string, clientWriteId?: string): Promise<ToolResponse>;
/** ⚠ `op="grant"` MOVED OUT on 2026-09-18 — `knowledge-ops-grant.ts`. This
 *  file was on the 500-line cap. */
