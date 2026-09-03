/**
 * `op="status"` — THE STATE MACHINE, READ IN ONE CALL.
 *
 * ⚠ **`read_sessions` AND `read_directions` WERE TWO OPS FOR ONE QUESTION** (B8,
 * 2026-09-02). "What is running on my machine" and "what is queued for it" are
 * the two halves of the same answer, and an orchestrator that asked only the
 * first read a machine with nothing running and no idea that three directions
 * were waiting to be claimed. `delivery=idle` on a send says the message was
 * FILED; this is the op that says what became of it, so the two contracts meet.
 *
 * ⚠ **COMPOSED FROM THE TWO EXISTING RENDERERS, NOT REWRITTEN.** Each already
 * owns a vocabulary — the session table's hedged cells and its legend, the
 * mailbox's scope line — and merging them into one renderer would mean one
 * function deciding which of two vocabularies a row belongs to. The seam is a
 * blank line.
 *
 * ⚠ **THE DIRECTIONS HALF IS APPENDED, NEVER SUBSTITUTED.** An error from either
 * half returns AS the result: a status page that silently drops the half that
 * failed is a page claiming a machine has no pending work when nobody asked it.
 *
 * ⚠ `channel-` filename prefix is REQUIRED by the parity split-scan.
 */
import type { DoplClient } from "@dopl/client";
import { type ToolResponse } from "./respond";
import type { ResponseFormat } from "./response-size";
import type { WorkspaceDirectory } from "../workspace-directory.js";
export declare function opStatus(client: DoplClient, directory: WorkspaceDirectory, opts?: {
    /** Optional channel filter; omitted reads the WHOLE ACCOUNT (T22). */
    channel?: string;
    /** Optional agent filter for the directions half. */
    agent?: string;
    format?: ResponseFormat;
}): Promise<ToolResponse>;
