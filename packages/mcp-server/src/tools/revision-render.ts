/**
 * HISTORY + RESTORE, the parts `dopl_kb`, `dopl_skill` and `dopl_ontology` share (DMP-002,
 * 2026-09-23): one row renderer, one restore-error mapper, and the two codes a restore refusal
 * leads with — so the three tools cannot describe one failure three ways.
 *
 * ⚠ A RESTORE DESTROYS NOTHING: it writes an old snapshot back as a NEW revision, and the source
 * row stays. That is why the routes are agent-reachable (not `sessionOnly`); the server's write
 * gates still apply, and every restore here carries the caller's `expected_version`.
 */

import type { ContentRevision } from "@dopl/client";
import { inlineOr } from "./narration.js";
import { apiErrorCode, err, isConflict, type ToolResponse } from "./respond.js";
import { refusal, versionConflict, type ToolError } from "./tool-errors.js";

/** Emit-only: 404 `REVISION_NOT_FOUND` (unknown id, another item's revision, or unreadable). */
export function revisionNotFound(historyOp: string): ToolError {
  return {
    reason: "revision_not_found",
    meaning: "no revision by that id on this item, or none you can read; nothing changed",
    retry: historyOp,
  };
}

/** Emit-only: 409 `REVISION_NOT_RESTORABLE` — a move, a link, or a create/delete bundle. */
export const REVISION_NOT_RESTORABLE: ToolError = {
  reason: "revision_not_restorable",
  meaning: "that revision holds nothing to write back (a move, a link, or a create/delete bundle); nothing changed",
  retry: "pick another revision",
};

/** Default rows per history page; the server's own page cap bounds `limit`. */
export const HISTORY_PAGE_DEFAULT = 20;

/** Who wrote a row, relative to the caller. ⚠ Never a name: an id is the only unforgeable handle. */
export function actorLabel(rev: ContentRevision, callerUserId: string | null): string {
  if (rev.actor.userId && rev.actor.userId === callerUserId) {
    return rev.actor.kind === "agent" ? "your agent" : "you";
  }
  return rev.actor.kind === "agent" ? "a member's agent" : "a member";
}

/** True when the snapshot was written by someone other than the caller — its body is fenced. */
export function foreignRevision(rev: ContentRevision, callerUserId: string | null): boolean {
  return !callerUserId || rev.actor.userId !== callerUserId;
}

/** One history row: id first (the handle), then what happened, when, by whom. */
export function revisionRow(rev: ContentRevision, callerUserId: string | null, extra = ""): string {
  const summary = rev.summary ? ` · ${inlineOr(rev.summary, "")}` : "";
  return `- \`${rev.id}\` · ${rev.op} · ${rev.createdAt} · by ${actorLabel(rev, callerUserId)}${extra}${summary}`;
}

/** The paging tail: the next cursor verbatim, or an explicit end. */
export function pageTail(nextCursor: string | null, cursorArg: string): string {
  return nextCursor ? `More: ${cursorArg}="${nextCursor}"` : "End of history.";
}

/**
 * Map a restore failure to a named refusal, or null (rethrow). `readOp` is the call that yields
 * a fresh Version; `historyOp` the one that lists revisions.
 */
export function restoreRefusal(e: unknown, readOp: string, historyOp: string): ToolResponse | null {
  if (isConflict(e)) {
    return err(
      refusal(
        versionConflict(readOp),
        "NOTHING was restored. Somebody wrote after the Version you passed — read the current state, confirm the restore still makes sense, then re-issue with the new expected_version.",
      ),
    );
  }
  const code = apiErrorCode(e);
  if (code === "REVISION_NOT_FOUND") return err(refusal(revisionNotFound(historyOp)));
  if (code === "REVISION_NOT_RESTORABLE") return err(refusal(REVISION_NOT_RESTORABLE));
  return null;
}

/** Refused before any write: the Version the caller holds is not the current one. */
export function staleBeforeRestore(readOp: string, current: string, passed: string): ToolResponse {
  return err(
    refusal(
      versionConflict(readOp),
      `NOTHING was restored. You passed expected_version=${inlineOr(passed, "`(empty)`")} but the current Version is \`${current}\` — something changed since your read. Re-read, confirm, then re-issue with the current Version.`,
    ),
  );
}
