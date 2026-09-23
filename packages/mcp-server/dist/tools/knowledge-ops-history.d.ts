/**
 * `dopl_kb` op="history" and op="restore" — one ENTRY's changelog, one revision read, and the
 * write-back (DMP-002, 2026-09-23). The app's Changelog panel reads the same route.
 *
 * ⚠ `history` WITH `revision` IS THE PREVIEW: it prints the snapshot a restore would write and
 * the current Version to pass, so the old/new summary is in hand BEFORE the write.
 * ⚠ `restore` REQUIRES `expected_version` and checks it twice — here, before the call, and in
 * the route (`X-Updated-At`, atomic) — so a restore over a newer edit is refused, never a clobber.
 */
import type { DoplClient } from "@dopl/client";
import { type ToolResponse } from "./respond";
export declare function opHistory(client: DoplClient, baseRef: string, path: string, callerUserId: string | null, opts: {
    revision?: string;
    limit?: number;
    cursor?: string;
}): Promise<ToolResponse>;
export declare function opRestore(client: DoplClient, baseRef: string, path: string, revisionId: string, expectedVersion: string): Promise<ToolResponse>;
