import "server-only";
// ⚠ THE ONE CROSS-FEATURE IMPORT ON THE LAUNCH PATH, AND IT IS THE COMPOSITION
// RATHER THAN THE COPY. `resolveTemplateRef` applies `canSeeTemplate` — the
// visibility matrix that is ALREADY written twice (that function and
// `agent_templates_member_select`) and documented as having to move together. A
// third statement of it here is precisely the shape F-278 is filed against ("the
// copy is the one that will not notice"). INVARIANTS §1 says there are no
// cross-feature imports; F-275 records that the tree has never obeyed that and
// that `channels → agent-templates` already exists on the client side.
// ⚠ **THE IMPORT MOVED HERE WITH THE RESOLVER ON 2026-09-02** (§1 cap: A10's
// idempotency probe pushed `service-launch.ts` to 552). It is still the ONE
// cross-feature edge on this path — it did not become a second one.
import {
  resolveTemplateRef,
  type TemplateRefMatch,
} from "@/features/agent-templates/server/service";
import {
  LaunchTemplateAmbiguousError,
  LaunchTemplateNotFoundError,
} from "./errors";
import type { ChannelContext } from "./service-shared";

/**
 * THE TEMPLATE HALF OF A LAUNCH DIRECTIVE — resolving the caller's `template`
 * ref to an ID, under the ORCHESTRATOR's own credential, BEFORE any row exists.
 *
 * ⚠ SPLIT OUT OF `service-launch.ts` ON 2026-09-02 at the §1 cap, and the seam is
 * the subject rather than the size: that file owns the DIRECTIVE LIFECYCLE
 * (create gates, claim CAS, decide, lazy expiry) and this one owns WHAT NAMING A
 * TEMPLATE DOES. They move on different clocks — the lifecycle when the mailbox
 * does, this when agent templates do — which is the seam
 * `service-launch-template.test.ts` already drew for the tests.
 *
 * ⚠ **THE RESOLUTION HAPPENS AT REQUEST TIME AND THE ROW STORES THE ID** (G9).
 * That is what stops a template being resolved twice under two people's
 * visibility: the desktop reads CONTENT by id at spawn
 * (`main/template-resolve.js › resolveTemplate`, which refuses anything that is
 * not a UUID) and never re-resolves a NAME.
 */

/**
 * ⚠ WHAT A DIRECTIVE STORES ABOUT A TEMPLATE, AND WHY IT IS NOT THE CONTENT.
 *
 * The row carries the resolved `id` plus a NAME SNAPSHOT and nothing else. The
 * INSTRUCTIONS, fields and knowledge bases are read on the DESKTOP, at spawn,
 * under the OPERATOR's own credential (`main/template-resolve.js`) — which is
 * load-bearing rather than tidy: `knowledgeBases` is viewer-filtered, and on this
 * lane the caller who NAMED the template and the operator who RUNS it are
 * routinely different people. Resolving content here would attach the
 * orchestrator's reach to the operator's session.
 */
export type DirectiveTemplate = { id: string; name: string } | null;

/**
 * RESOLVE THE CALLER'S `template` REF — **the CREATE fence, under the
 * ORCHESTRATOR's credential** (spec §3e).
 *
 * ⚠ THERE ARE TWO FENCES ON THIS LANE AND THEY BELONG TO DIFFERENT PEOPLE. This
 * one says the caller cannot NAME what it cannot SEE. The other runs on the
 * desktop at spawn and says the OPERATOR cannot RUN what THEY cannot see. Both
 * are required and neither substitutes: a `team` template the orchestrator is in
 * and the operator is not passes here and is refused there, as `no-template`.
 * That is a real, fail-closed state, stated in the docs rather than debugged.
 *
 * ⚠ AMBIGUITY REFUSES AND LISTS. Never picks — see
 * {@link LaunchTemplateAmbiguousError}.
 */
export async function resolveTemplateForDirective(
  ctx: ChannelContext,
  ref: string | undefined
): Promise<DirectiveTemplate> {
  if (ref === undefined) return null;
  const resolution = await resolveTemplateRef(
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
      // line puts `AGENT_TEMPLATE_NOT_FOUND` on every private template a
      // session names — including every "Use in this channel" copy, which
      // `containerCopyDraft` forces to `private` (F-333).
      apiKeyWorkspaceId: ctx.apiKeyWorkspaceId ?? null,
      credentialSubjectUserId: ctx.credentialSubjectUserId,
    },
    ref
  );
  if (resolution.kind === "ambiguous") {
    throw new LaunchTemplateAmbiguousError(
      ref,
      resolution.matches as ReadonlyArray<TemplateRefMatch>
    );
  }
  if (resolution.kind === "not-found") {
    throw new LaunchTemplateNotFoundError(ref);
  }
  // ⚠ THE SAME 404, WITH THE ONE FACT THAT MAKES IT ACTIONABLE (T35). A ref that
  // resolves in a tenancy the caller belongs to but NOT in this channel's is the
  // commonest miss on this lane and the one whose honest cause the old sentence
  // could not name. The classification is the template feature's — this file
  // adds no rule of its own to it, it only carries the answer.
  if (resolution.kind === "elsewhere") {
    throw new LaunchTemplateNotFoundError(ref, resolution.template);
  }
  // 🔒 **THE TWO LANES OF ONE LAUNCH NOW AGREE ABOUT WHAT AN ID MAY NAME —
  // SAMUEL'S RULING #18, LANDED IN B2** (2026-09-02). Wave A recorded the
  // asymmetry here rather than closing it, because closing it was a decision and
  // not a fix.
  //
  // This function is the REF DISAMBIGUATION door, under the ORCHESTRATOR's
  // credential. The desktop's spawn-time door is
  // `GET /api/agent-templates/{id}/resolve` → `agent-templates/server/
  // service-reads.ts › resolveTemplateForLaunch` → `readTemplateById`, under the
  // OPERATOR's. Both now compose `shared/tenancy/read-resource.ts ›
  // readResourceById`, so an id naming a template on someone's PERSONAL shelf
  // resolves on BOTH — which is ruling #18 in one sentence: **a personal
  // template launches anywhere its owner is.**
  //
  // ⚠ **AGREEING ABOUT THE ID IS NOT THE SAME AS BEING ONE FENCE, AND THE TWO
  // FENCES ARE UNCHANGED.** They still belong to different people and still
  // fail closed independently: a `team` template the orchestrator is in and the
  // operator is not passes here and is refused there, as `no-template`. What
  // changed is only WHICH CONTAINER each one asks in.
  //
  // ⚠ A NAME STILL DOES NOT FOLLOW, on either lane — `agent_templates` has no
  // name uniqueness, so a name matching in two containers has no non-arbitrary
  // answer. That is why `LaunchTemplateNotFoundError`'s `elsewhere` label
  // survives above.
  //
  // ⚠ THERE IS STILL EXACTLY ONE READ DOOR FOR LAUNCH CONTENT
  // (`readTemplateById`) and no duplicate resolver: this lane resolves a REF and
  // never reads the template's content.
  return { id: resolution.id, name: resolution.name };
}
