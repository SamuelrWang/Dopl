import "server-only";
// ⚠ THE ONE CROSS-FEATURE IMPORT ON THE LAUNCH PATH, AND IT IS THE COMPOSITION
// RATHER THAN THE COPY. `resolveIdentityRef` applies `canSeeIdentity` — the
// visibility matrix that is ALREADY written twice (that function and
// `agent_identities_member_select`) and documented as having to move together. A
// third statement of it here is precisely the shape F-278 is filed against ("the
// copy is the one that will not notice"). INVARIANTS §1 says there are no
// cross-feature imports; F-275 records that the tree has never obeyed that and
// that `channels → agent-identities` already exists on the client side.
// ⚠ **THE IMPORT MOVED HERE WITH THE RESOLVER ON 2026-09-02** (§1 cap: A10's
// idempotency probe pushed `service-launch.ts` to 552). It is still the ONE
// cross-feature edge on this path — it did not become a second one.
import {
  resolveIdentityRef,
  type IdentityRefMatch,
} from "@/features/agent-identities/server/service";
import {
  LaunchIdentityAmbiguousError,
  LaunchIdentityNotFoundError,
} from "./errors";
import type { ChannelContext } from "./service-shared";

/**
 * THE IDENTITY HALF OF A LAUNCH DIRECTIVE — resolving the caller's `identity`
 * ref to an ID, under the ORCHESTRATOR's own credential, BEFORE any row exists.
 *
 * ⚠ SPLIT OUT OF `service-launch.ts` ON 2026-09-02 at the §1 cap, and the seam is
 * the subject rather than the size: that file owns the DIRECTIVE LIFECYCLE
 * (create gates, claim CAS, decide, lazy expiry) and this one owns WHAT NAMING A
 * IDENTITY DOES. They move on different clocks — the lifecycle when the mailbox
 * does, this when agent identities do — which is the seam
 * `service-launch-identity.test.ts` already drew for the tests.
 *
 * ⚠ **THE RESOLUTION HAPPENS AT REQUEST TIME AND THE ROW STORES THE ID** (G9).
 * That is what stops an identity being resolved twice under two people's
 * visibility: the desktop reads CONTENT by id at spawn
 * (`main/identity-resolve.js › resolveAgentIdentity`, which refuses anything that is
 * not a UUID) and never re-resolves a NAME.
 */

/**
 * ⚠ WHAT A DIRECTIVE STORES ABOUT AN IDENTITY, AND WHY IT IS NOT THE CONTENT.
 *
 * The row carries the resolved `id` plus a NAME SNAPSHOT and nothing else. The
 * INSTRUCTIONS, fields and knowledge bases are read on the DESKTOP, at spawn,
 * under the OPERATOR's own credential (`main/identity-resolve.js`) — which is
 * load-bearing rather than tidy: `knowledgeBases` is viewer-filtered, and on this
 * lane the caller who NAMED the identity and the operator who RUNS it are
 * routinely different people. Resolving content here would attach the
 * orchestrator's reach to the operator's session.
 */
export type DirectiveIdentity = { id: string; name: string } | null;

/**
 * RESOLVE THE CALLER'S `identity` REF — **the CREATE fence, under the
 * ORCHESTRATOR's credential** (spec §3e).
 *
 * ⚠ THERE ARE TWO FENCES ON THIS LANE AND THEY BELONG TO DIFFERENT PEOPLE. This
 * one says the caller cannot NAME what it cannot SEE. The other runs on the
 * desktop at spawn and says the OPERATOR cannot RUN what THEY cannot see. Both
 * are required and neither substitutes: a `team` identity the orchestrator is in
 * and the operator is not passes here and is refused there, as `no-identity`.
 * That is a real, fail-closed state, stated in the docs rather than debugged.
 *
 * ⚠ AMBIGUITY REFUSES AND LISTS. Never picks — see
 * {@link LaunchIdentityAmbiguousError}.
 */
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
      // ⚠ BOTH AXES ARE CARRIED, NOT DROPPED, AND THEY DO DIFFERENT WORK.
      // The CONTAINER axis is the tenancy fence. The SUBJECT axis is arm 2 of
      // the matrix (M-10): a credential that may be passed between humans
      // inherits no one person's reach and must see NOTHING beyond
      // `visibility: 'workspace'`, while a container SESSION carries its
      // operator's id and sees what the operator sees. Dropping the subject
      // line puts `AGENT_IDENTITY_NOT_FOUND` on every private identity a
      // session names — which is every identity on the operator's personal
      // shelf (F-333).
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
  // ⚠ THE SAME 404, WITH THE ONE FACT THAT MAKES IT ACTIONABLE (T35). A ref that
  // resolves in a tenancy the caller belongs to but NOT in this channel's is the
  // commonest miss on this lane and the one whose honest cause the old sentence
  // could not name. The classification is the identity feature's — this file
  // adds no rule of its own to it, it only carries the answer.
  if (resolution.kind === "elsewhere") {
    throw new LaunchIdentityNotFoundError(ref, resolution.identity);
  }
  // 🔒 **THE TWO LANES OF ONE LAUNCH NOW AGREE ABOUT WHAT AN ID MAY NAME —
  // SAMUEL'S RULING #18, LANDED IN B2** (2026-09-02). Wave A recorded the
  // asymmetry here rather than closing it, because closing it was a decision and
  // not a fix.
  //
  // This function is the REF DISAMBIGUATION door, under the ORCHESTRATOR's
  // credential. The desktop's spawn-time door is
  // `GET /api/agent-identities/{id}/resolve` → `agent-identities/server/
  // service-reads.ts › resolveIdentityForLaunch` → `readIdentityById`, under the
  // OPERATOR's. Both now compose `shared/tenancy/read-resource.ts ›
  // readResourceById`, so an id naming an identity on someone's PERSONAL shelf
  // resolves on BOTH — which is ruling #18 in one sentence: **a personal
  // identity launches anywhere its owner is.**
  //
  // ⚠ **AGREEING ABOUT THE ID IS NOT THE SAME AS BEING ONE FENCE, AND THE TWO
  // FENCES ARE UNCHANGED.** They still belong to different people and still
  // fail closed independently: a `team` identity the orchestrator is in and the
  // operator is not passes here and is refused there, as `no-identity`. What
  // changed is only WHICH CONTAINER each one asks in.
  //
  // ⚠ A NAME STILL DOES NOT FOLLOW, on either lane — `agent_identities` has no
  // name uniqueness, so a name matching in two containers has no non-arbitrary
  // answer. That is why `LaunchIdentityNotFoundError`'s `elsewhere` label
  // survives above.
  //
  // ⚠ THERE IS STILL EXACTLY ONE READ DOOR FOR LAUNCH CONTENT
  // (`readIdentityById`) and no duplicate resolver: this lane resolves a REF and
  // never reads the identity's content.
  return { id: resolution.id, name: resolution.name };
}
