import "server-only";
// The one cross-feature import on this path: composing the identity feature's resolver rather than
// writing its visibility matrix a third time (F-278, F-275).
import {
  resolveIdentityRef,
  type IdentityRefMatch,
} from "@/features/agent-identities/server/service";
import {
  LaunchIdentityAmbiguousError,
  LaunchIdentityNotFoundError,
} from "./errors";
import type { ChannelContext } from "./service-shared";

/** Resolves a launch's `identity` ref to an id under the caller's credential, before any row exists.
 *  The row stores the id; the desktop reads content by id at spawn and never re-resolves a name
 *  (`main/identity-resolve.js › resolveAgentIdentity`). */

/** Id plus a name snapshot, never content: the desktop reads instructions and knowledge bases under
 *  the operator's own credential at spawn, so the caller's reach never attaches to the session. */
export type DirectiveIdentity = { id: string; name: string } | null;

/** The create-time fence: the caller cannot name what it cannot see. The desktop's spawn-time fence
 *  (the operator cannot run what they cannot see) is separate; either may refuse (`no-identity`).
 *  An ambiguous name refuses and lists, never picks. */
export async function resolveIdentityForDirective(
  ctx: ChannelContext,
  ref: string | undefined
): Promise<DirectiveIdentity> {
  if (ref === undefined) return null;
  const resolution = await resolveIdentityRef(
    {
      workspaceId: ctx.workspaceId,
      userId: ctx.userId,
      source: ctx.source,
      role: ctx.role,
      // Both axes: the container axis is the tenancy fence; the subject axis gives a session its
      // operator's reach, while a shareable key sees only workspace-visible identities (F-333).
      apiKeyWorkspaceId: ctx.apiKeyWorkspaceId ?? null,
      credentialSubjectUserId: ctx.credentialSubjectUserId,
    },
    ref
  );
  if (resolution.kind === "ambiguous") {
    throw new LaunchIdentityAmbiguousError(
      ref,
      resolution.matches as ReadonlyArray<IdentityRefMatch>
    );
  }
  if (resolution.kind === "not-found") {
    throw new LaunchIdentityNotFoundError(ref);
  }
  // The same 404, plus the one non-leaky fact: the ref resolves in another tenancy the caller is in.
  if (resolution.kind === "elsewhere") {
    throw new LaunchIdentityNotFoundError(ref, resolution.identity);
  }
  // An id resolves the same way here and at spawn (`service-reads.ts › resolveIdentityForLaunch`):
  // both compose `readResourceById`, so an identity on its owner's personal shelf launches anywhere.
  return { id: resolution.id, name: resolution.name };
}
