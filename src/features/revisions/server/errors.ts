/** Domain errors for `revisions`. Mapped to HTTP by
 *  `shared/api/revisions-route.ts`. */

export class RevisionNotFoundError extends Error {
  readonly code = "REVISION_NOT_FOUND";
  constructor(id: string) {
    // ⚠ ONE ANSWER FOR THREE FACTS — "no such revision", "its resource is
    // invisible to you" and "its resource has been deleted" — the same
    // 404-not-403 rule `knowledge/server/service-entries.ts › getEntry` applies
    // one level up. A distinct refusal would confirm that an id a caller guessed
    // names a real revision of something they may not see.
    super(`Revision ${id} not found`);
    this.name = "RevisionNotFoundError";
  }
}

/** A restore whose snapshot cannot be written back — the source revision holds
 *  no body (a `move` or a base rename), so there is nothing to restore. */
export class RevisionNotRestorableError extends Error {
  readonly code = "REVISION_NOT_RESTORABLE";
  constructor(id: string) {
    super(`Revision ${id} carries no content snapshot to restore`);
    this.name = "RevisionNotRestorableError";
  }
}
