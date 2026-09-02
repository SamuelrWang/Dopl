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
      // ⚠ CARRIED, NOT DROPPED, AND IT IS ARM 2 OF THE MATRIX (M-10). A
      // workspace-scoped API key may be shared between humans, so it inherits no
      // one person's reach and must see NOTHING beyond `visibility: 'workspace'`.
      // `canSeeTemplate` reads this field; handing it `null` would let such a key
      // resolve the key-owner's private templates by name.
      apiKeyWorkspaceId: ctx.apiKeyWorkspaceId ?? null,
      // ⚠ AND ITS KIND, OR ARM 2 REFUSES THE OPERATOR'S OWN SESSION (F-333).
      // Dropping this line puts `AGENT_TEMPLATE_NOT_FOUND` on every private
      // template a locked session names — including every "Use in this channel"
      // copy, which `containerCopyDraft` forces to `private`.
      apiKeyWorkspaceLockKind: ctx.apiKeyWorkspaceLockKind ?? null,
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
  return { id: resolution.id, name: resolution.name };
}
