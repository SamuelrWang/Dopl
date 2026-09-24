/**
 * `dopl_skill` op="history" and op="restore" — the SKILL.md body's version list, one version
 * read, and the write-back. The app's history panel reads the same routes.
 *
 * ⚠ `history` WITH `revision` IS THE PREVIEW (the old body plus the current Version to pass), so
 * the old/new summary is in hand BEFORE the write. ⚠ `restore` REQUIRES `slug` as well as the
 * version id and refuses a version that belongs to ANOTHER skill — the route is keyed by version
 * alone, and an id copied from the wrong list must not roll back the wrong procedure.
 */
import type { DoplClient } from "@dopl/client";
import { type ToolResponse } from "./respond";
export declare function opHistory(client: DoplClient, slug: string, callerUserId: string | null, opts: {
    revision?: string;
    limit?: number;
}): Promise<ToolResponse>;
export declare function opRestore(client: DoplClient, slug: string, versionId: string, expectedVersion: string): Promise<ToolResponse>;
