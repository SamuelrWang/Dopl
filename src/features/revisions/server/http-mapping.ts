import "server-only";
import { HttpError } from "@/shared/lib/http-error";
import { RevisionNotFoundError, RevisionNotRestorableError } from "./errors";

/**
 * THE CHANGELOG'S TWO DOMAIN ERRORS → `HttpError`, IN ONE PLACE.
 *
 * ⚠ **IT MOVED HERE ON 2026-09-09 (part 2) FROM
 * `knowledge/server/http-mapping.ts`, WHOSE COMMENT SAID "every revision
 * surface in this app is a KNOWLEDGE route" — TRUE UNTIL THE ONTOLOGY ROUTES
 * LANDED.** Two mappers is exactly the shape that comment warned about: one
 * place a 404 could become a 403, twice. Knowledge's mapper now DELEGATES here,
 * so both families answer with one status and one code.
 *
 * `null` for anything unrecognized, so callers fall through to their own map and
 * then to the generic 500 path.
 */
export function mapRevisionError(err: unknown): HttpError | null {
  if (err instanceof RevisionNotFoundError) {
    // ⚠ ONE ANSWER FOR "no such revision", "not yours to see" and "its resource
    // is gone" — `./errors.ts` carries the argument.
    return new HttpError(404, "REVISION_NOT_FOUND", err.message);
  }
  if (err instanceof RevisionNotRestorableError) {
    return new HttpError(409, "REVISION_NOT_RESTORABLE", err.message);
  }
  return null;
}
