import "server-only";
import { readResourceById } from "@/shared/tenancy/read-resource";
import type {
  AgentTemplate,
  AgentTemplateContext,
  ResolvedAgentTemplate,
  TemplateShelf,
} from "../types";
import { AgentTemplateNotFoundError } from "./errors";
import * as repo from "./repository";
// ⚠ THE KB DECORATION MOVED OUT ON 2026-09-05 at the §2 cap — same seam
// `repository-knowledge-links.ts` was cut on. This file owns which rows a caller
// may SEE; that one owns what their attachments RESOLVE TO.
import { decorateWithKnowledgeBases } from "./service-knowledge-decoration";
import {
  canSeeTemplate,
  shareCtxForTemplates,
  withSharingSet,
} from "./service-shared";

/**
 * Agent-template reads. `getTemplateById` is THE visibility-checked lookup
 * every other op funnels through — writes included — so there is exactly one
 * place a caller can be told a template exists.
 */

/**
 * Every template the caller may see, name-ordered, each carrying its
 * `visibility` so the client can GROUP without a second call. ⚠ The server
 * deliberately does NOT group: grouping is a rendering decision (a picker wants
 * flat-with-headers, a settings page wants sections) and a grouped payload
 * forces one of those on every consumer.
 *
 * ⚠ `opts.shelf` NARROWS TO ONE SHELF (`../types.ts › TemplateShelf`) — the
 * /home pane's Personal section asks for `"home"`, the workspace Agents page for
 * `"workspace"`, and everything else (the launch picker, `resolveTemplateRef`,
 * MCP) omits it and gets BOTH. It is applied in the QUERY, not over the result,
 * so a shelf the caller did not ask for never reaches the wire (INVARIANTS §11).
 *
 * 🔒 THE SHELF IS ORTHOGONAL TO `canSeeTemplate`, which runs AFTER it and is
 * unchanged. Shelf = which surface lists it; visibility = who may read it. A
 * narrowed read can only ever return a SUBSET of what the unfiltered one would.
 */
export async function listTemplates(
  ctx: AgentTemplateContext,
  opts: { shelf?: TemplateShelf } = {}
): Promise<AgentTemplate[]> {
  const all = await repo.listTemplatesForWorkspace(ctx.workspaceId, opts.shelf);
  if (all.length === 0) return [];
  const share = await shareCtxForTemplates(ctx, all);
  const visible = all
    .filter((t) => canSeeTemplate(ctx, t, share))
    .map((t) => withSharingSet(ctx, t, share));
  return decorateWithKnowledgeBases(ctx, visible);
}

/**
 * Which of `templates` sit on the caller's PERSONAL (/home) shelf — the sibling
 * key behind `GET /api/agent-templates › homeScopedTemplateIds` (2026-08-28).
 *
 * 🔒 ⚠ **A LABEL OVER AN ALREADY-FENCED LIST.** It takes the rows `listTemplates`
 * already put through `canSeeTemplate`, and answers which of THOSE carry the
 * flag. No visibility of its own; never a wider set. Twin of
 * `knowledge/server/service-bases.ts › listHomeScopedBaseIds`, and the pair must
 * move together — two list surfaces disagreeing about whether a shelf is
 * knowable is exactly the confusion the one-mapping rule exists to prevent.
 */
export async function listHomeScopedTemplateIds(
  ctx: AgentTemplateContext,
  templates: AgentTemplate[]
): Promise<string[]> {
  if (templates.length === 0) return [];
  const visible = new Set(templates.map((t) => t.id));
  const scoped = await repo.listHomeScopedTemplateIds(ctx.workspaceId, [
    ...visible,
  ]);
  return scoped.filter((id) => visible.has(id));
}

/**
 * ⚠ 404 — NEVER 403 — WHEN THE CALLER CANNOT SEE IT. A distinguishable
 * "forbidden" would confirm that a private template with that id exists, which
 * is exactly the oracle the visibility matrix is there to close. Same rule as
 * `getSkillBySlug`.
 *
 * 🔒 ⚠ **THIS ONE IS KEYED TO `ctx.workspaceId` AND MUST STAY THAT WAY — IT IS
 * THE WRITE GATE.** `service-writes.ts` funnels create, update and delete
 * through it, so the tenancy it reads in is the tenancy those writes land in.
 * The ID-RESOLVING read is {@link readTemplateById}, and the split is the whole
 * reason A12 is a READ pilot: a PATCH that followed an id into another container
 * would be `workspace=` becoming ignorable on a WRITE, which nobody has ruled.
 */
export async function getTemplateById(
  ctx: AgentTemplateContext,
  id: string
): Promise<AgentTemplate> {
  const template = await loadVisibleTemplate(ctx, id);
  if (!template) throw new AgentTemplateNotFoundError(id);
  return template;
}

/**
 * 🔒 **THE ID-RESOLVING READ (A12).** The same row, the same matrix, the same
 * 404 — but the id says which container to apply them in, so `workspace=` is
 * optional on the way in.
 *
 * ⚠ **A `workspace=` THAT CONTRADICTS A RESOLVABLE ID IS IGNORED, NOT REFUSED.**
 * An id is globally unique, so a caller who names one has said everything the
 * read needs; the workspace it was asked in was only ever the key the query
 * happened to be built on, and answering "not here" to a caller holding a
 * perfectly good id is the defect the "it lives elsewhere" subsystem existed to
 * apologise for.
 *
 * ⚠ **RESOLUTION IS NOT AUTHORISATION AND THE ORDER SAYS SO.** The resolver
 * (`shared/tenancy/resolve-resource.ts`) is strictly NARROWER than
 * `canSeeTemplate` — it names only rows the caller could already list — and the
 * matrix then runs AGAIN in the container it named, with the caller's real role
 * there. Two fences, and a row that clears one and not the other is the same
 * 404 as a row that exists nowhere.
 *
 * ⚠ IT COSTS TWO EXTRA READS **ONLY ON A MISS IN THIS TENANCY**; a template that
 * resolves where it was asked for is byte-identical to before.
 *
 * ⚠ **THE FOLLOW ITSELF IS `shared/tenancy/read-resource.ts › readResourceById`
 * SINCE B2**, where it was twelve hand-written lines here. Knowledge bases,
 * skills and chats compose the same function, and the copy that would have gone
 * wrong is the one this file used to be the only example of: the re-based
 * context's `role`.
 */
export async function readTemplateById(
  ctx: AgentTemplateContext,
  id: string
): Promise<AgentTemplate> {
  const hit = await readResourceById(
    ctx,
    "agent_template",
    id,
    loadVisibleTemplate
  );
  if (!hit) throw new AgentTemplateNotFoundError(id);
  return hit.value;
}

/** The read every door shares: one row, in ONE named container, through the
 *  matrix and the viewer-filtered decoration. `null` = not visible, which the
 *  callers turn into the single 404. */
async function loadVisibleTemplate(
  ctx: AgentTemplateContext,
  id: string
): Promise<AgentTemplate | null> {
  const template = await repo.findTemplateById(ctx.workspaceId, id);
  if (!template) return null;
  const share = await shareCtxForTemplates(ctx, [template]);
  if (!canSeeTemplate(ctx, template, share)) return null;
  const [decorated] = await decorateWithKnowledgeBases(ctx, [
    withSharingSet(ctx, template, share),
  ]);
  return decorated;
}

/**
 * THE LAUNCH-RESOLUTION PAYLOAD. Flattened, id-free, and the contract the
 * desktop fetches at spawn time with its device token.
 *
 * ⚠ IT GOES THROUGH `getTemplateById`, SO IT IS GATED BY THE SAME MATRIX AS
 * EVERY OTHER READ. A "resolve" endpoint that resolved more than a "get" would
 * be a second, weaker door onto the same row — and the desktop presents a
 * user's credential, not a privileged one.
 *
 * ⚠ THE ATTACHMENT LIST IS VIEWER-FILTERED, NOT TEMPLATE-DEFINED. A KB the
 * SPAWNING caller cannot read is omitted, even though the template names it, so
 * a shared template cannot be used as a delivery vehicle for someone else's
 * private base. The consequence, stated so the integration builder does not
 * read it as a bug: **two people resolving the same template can get different
 * `knowledgeBases` arrays.**
 *
 * ── ⚠ `authoredByCaller` — THE SIXTH KEY, ADDED 2026-08-22 (G-1) ──────────
 *
 * The desktop's ROLE block wears a DIFFERENT SECURITY HEADER depending on who
 * wrote the template it is about to run as: the operator's own configuration
 * gets the operator posture, and another member's gets the
 * `UNTRUSTED_SKILL_BODY_HEADER`-shaped one. That gate cannot be built without
 * this field, and it is the tree's established pattern —
 * `packages/mcp-server/src/tools/narration.ts › isForeignAuthored` gates the
 * untrusted headers on authorship for exactly the same reason
 * `knowledge-shared.ts` states in one line: *"noise is how a security header
 * stops being read."*
 *
 * ⚠ A COMPUTED BOOLEAN, NEVER `createdBy`. A raw creator id in a LAUNCH payload
 * is ownership information the launcher does not need, and this endpoint's whole
 * design is that it carries no ids, no visibility and no timestamps. The boolean
 * discloses nothing the caller does not already know from the list endpoint,
 * where `createdBy` is on the DTO for the selector's authorship marker.
 *
 * ⚠ IT IS ABOUT AUTHORSHIP, NOT ABOUT PERMISSION. `createdBy` is `SET NULL` when
 * a member leaves the workspace, so a template whose author is gone resolves
 * `false` — the stronger header — for everyone including a workspace admin. That
 * is the correct direction: nobody left can vouch for it.
 * ⚠ AND THE DESKTOP FAILS FOREIGN INDEPENDENTLY: `template-resolve.js › narrow`
 * treats anything that is not an explicit `true` as somebody else's, so an older
 * server that does not send this field cannot silently downgrade a header.
 *
 * ── ⚠ THE MISS THAT USED TO CARRY A TENANCY NOW RESOLVES INSTEAD (A12) ──────
 *
 * This door composes {@link readTemplateById}, so a launch that names a template
 * of the operator's own living in ANOTHER container of theirs now SUCCEEDS
 * rather than 404-ing with an `elsewhere` label the desktop could only log. The
 * classification was the apology for a read that could not follow its own id;
 * `service-resolve-ref.ts › classifyMissingTemplateRef` still answers the MCP
 * create fence, where a NAME cannot resolve a tenancy.
 * ⚠ THE REFUSAL IS UNCHANGED WHERE IT STILL BITES — still 404, still never 403,
 * and a template the operator could not list for themselves anywhere resolves
 * nowhere.
 */
export async function resolveTemplateForLaunch(
  ctx: AgentTemplateContext,
  id: string
): Promise<ResolvedAgentTemplate> {
  const template = await readTemplateById(ctx, id);
  return {
    name: template.name,
    instructions: template.instructions,
    model: template.model,
    fields: template.fields,
    knowledgeBases: template.knowledgeBases,
    // ⚠ CARRIED, NOT RECOMPUTED, and `?? 0` reads "the decoration did not run",
    // which on this door cannot happen — `readTemplateById` always decorates.
    // The coalesce is the honest default rather than a claim of reachability:
    // saying "1 unreachable" on a row nobody counted would be an invention, and
    // saying nothing is what the launch already did before today.
    unreachableKnowledgeBaseCount: template.unreachableKnowledgeBaseCount ?? 0,
    authoredByCaller:
      template.createdBy !== null && template.createdBy === ctx.userId,
  };
}

