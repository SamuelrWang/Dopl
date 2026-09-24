/**
 * HISTORY + RESTORE, the parts `dopl_kb`, `dopl_skill` and `dopl_ontology` share: one row
 * renderer, one restore-error mapper, and the two codes a restore refusal leads with — so the
 * three tools cannot describe one failure three ways.
 *
 * ⚠ A RESTORE DESTROYS NOTHING: it writes an old snapshot back as a NEW revision, and the source
 * row stays. That is why the routes are agent-reachable (not `sessionOnly`); the server's write
 * gates still apply, and every restore here carries the caller's `expected_version`.
 */
import type { ContentRevision } from "@dopl/client";
import { type ToolResponse } from "./respond.js";
import { type ToolError } from "./tool-errors.js";
/** Emit-only: 404 `REVISION_NOT_FOUND` (unknown id, another item's revision, or unreadable). */
export declare function revisionNotFound(historyKey: string): ToolError;
/** Default rows per history page; the server's own page cap bounds `limit`. */
export declare const HISTORY_PAGE_DEFAULT = 20;
/** True when the snapshot was written by someone other than the caller — its body is fenced. */
export declare function foreignRevision(rev: ContentRevision, callerUserId: string | null): boolean;
/** One history row: id first (the handle), then what happened, when, by whom. */
export declare function revisionRow(rev: ContentRevision, callerUserId: string | null, extra?: string): string;
/** The paging tail: the next cursor verbatim, or an explicit end. */
export declare function pageTail(nextCursor: string | null, cursorArg: string): string;
/**
 * Map a restore failure to a named refusal, or null (rethrow). `readKey` is the call (a manifest
 * key) that yields a fresh Version; `historyKey` the one that lists revisions.
 */
export declare function restoreRefusal(e: unknown, readKey: string, historyKey: string): ToolResponse | null;
/** Refused before any write: the Version the caller holds is not the current one. */
export declare function staleBeforeRestore(readKey: string, current: string, passed: string): ToolResponse;
