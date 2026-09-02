import "server-only";
import { isSharedCredential } from "./credential-audience";
import type { CallerScope } from "@/shared/supabase/caller-scope";

/**
 * THE CALLER SCOPE, BUILT FROM AN ALREADY-VALIDATED CREDENTIAL — the two shapes
 * `with-auth.ts` puts into `runWithCallerScope` (Wave B B7).
 *
 * 🔒 ⚠ EVERY FIELD IS COMPUTED FROM WHAT THE WRAPPER PROVED, NEVER FROM A
 * HEADER. `X-Workspace-Id`, `X-Dopl-Runtime` and `X-Dopl-Session-Id` are
 * documented NON-authorization signals (INVARIANTS §10) and a device-token
 * holder can send any value for all three; nothing in this module reads a
 * request at all.
 *
 * ⚠ SEPARATE FROM `with-auth.ts` FOR ONE REASON: the M-10 axis is decided here
 * and it is decided ONCE. A second call site spelling `isSharedCredential`
 * inline is how the visibility rule grows a fourth copy — F-336 is the incident
 * where a WORKSPACE fence was used as a VISIBILITY fence in five places at once.
 */

/**
 * A SESSION — cookie, or the SPA's bearer Supabase JWT. No credential lock, so
 * `isSharedCredential`'s first arm answers `false`: a session is a person, and
 * always was.
 */
export function sessionCallerScope(userId: string): CallerScope {
  return { userId, sharedCredential: false, credentialWorkspaceId: null };
}

/**
 * A `dopl_at_` OAUTH TOKEN — the only lane where the axes are not constant.
 * The scope carries `isSharedCredential`'s ANSWER, so the minted JWT states the
 * axis and the policy asks the question the TS predicate asks.
 *
 * ⚠ **THE TWO AXES ARE READ SEPARATELY AND NEITHER IS INFERRED FROM THE OTHER**
 * (B3): `subject_user_id` answers WHOSE reach — the M-10 axis, and the only one
 * `isSharedCredential` may ask about — while `container_id` answers WHICH
 * container and is carried through untouched. Deriving the first from the second
 * is F-336, which is why this reads two fields rather than discriminating a
 * lock kind.
 * ⚠ FAILS CLOSED by construction: an absent subject reads as SHARED, exactly as
 * `credential-audience.ts` specifies.
 */
export function tokenCallerScope(tok: {
  userId: string;
  containerId?: string | null;
  subjectUserId?: string | null;
}): CallerScope {
  return {
    userId: tok.userId,
    sharedCredential: isSharedCredential({
      credentialSubjectUserId: tok.subjectUserId ?? null,
    }),
    credentialWorkspaceId: tok.containerId ?? null,
  };
}
