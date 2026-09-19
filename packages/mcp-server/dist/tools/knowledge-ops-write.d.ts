/**
 * `dopl_kb` non-destructive WRITE op handlers for what lives INSIDE a base:
 * create/move folders, write/move entries. Every write maps @dopl/client errors
 * — conflict (412), already-exists (409), agent-write-denied (403), and
 * validation (400) — to actionable tool messages. Routed from the registrar in
 * knowledge.ts.
 *
 * ⚠ **THE BASE-LEVEL WRITES LEFT ON 2026-09-18** for the 500-line cap:
 * create_base / update_base / set_visibility / grant are
 * `knowledge-ops-base-writes.ts`. The seam is the SUBJECT — that file writes a
 * base, this one writes what is in it.
 */
import type { DoplClient } from "@dopl/client";
import { type ToolResponse } from "./respond";
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
export declare function opWriteFile(client: DoplClient, ref: string, path: string, body: string, title?: string, expected_version?: string, force?: boolean, excerpt?: string, section?: string): Promise<ToolResponse>;
