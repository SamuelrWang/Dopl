import "server-only";
import type {
  AgentTemplate,
  AgentTemplateContext,
  ResolvedAgentTemplate,
  TemplateKnowledgeBaseRef,
} from "../types";
import { AgentTemplateNotFoundError } from "./errors";
import * as repo from "./repository";
import {
  canSeeTemplate,
  resolveVisibleKnowledgeBases,
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
 */
export async function listTemplates(
  ctx: AgentTemplateContext
): Promise<AgentTemplate[]> {
  const all = await repo.listTemplatesForWorkspace(ctx.workspaceId);
  if (all.length === 0) return [];
  const share = await shareCtxForTemplates(ctx, all);
  const visible = all
    .filter((t) => canSeeTemplate(ctx, t, share))
    .map((t) => withSharingSet(ctx, t, share));
  return decorateWithKnowledgeBases(ctx, visible);
}

/**
 * ⚠ 404 — NEVER 403 — WHEN THE CALLER CANNOT SEE IT. A distinguishable
 * "forbidden" would confirm that a private template with that id exists, which
 * is exactly the oracle the visibility matrix is there to close. Same rule as
 * `getSkillBySlug`.
 */
export async function getTemplateById(
  ctx: AgentTemplateContext,
  id: string
): Promise<AgentTemplate> {
  const template = await repo.findTemplateById(ctx.workspaceId, id);
  if (!template) throw new AgentTemplateNotFoundError(id);
  const share = await shareCtxForTemplates(ctx, [template]);
  if (!canSeeTemplate(ctx, template, share)) {
    throw new AgentTemplateNotFoundError(id);
  }
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
 */
export async function resolveTemplateForLaunch(
  ctx: AgentTemplateContext,
  id: string
): Promise<ResolvedAgentTemplate> {
  const template = await getTemplateById(ctx, id);
  return {
    name: template.name,
    instructions: template.instructions,
    model: template.model,
    fields: template.fields,
    knowledgeBases: template.knowledgeBases,
    authoredByCaller:
      template.createdBy !== null && template.createdBy === ctx.userId,
  };
}

/**
 * Side-load KB refs onto a visible row set — ONE junction query plus the
 * visibility resolution, regardless of row count.
 * ⚠ Filtered through the SAME `resolveVisibleKnowledgeBases` the attach gate
 * uses, so a base that was attachable when it was attached and has since gone
 * private simply disappears from the payload rather than leaking its name.
 */
async function decorateWithKnowledgeBases(
  ctx: AgentTemplateContext,
  templates: AgentTemplate[]
): Promise<AgentTemplate[]> {
  if (templates.length === 0) return [];
  const links = await repo.listKnowledgeLinksForTemplates(
    ctx.workspaceId,
    templates.map((t) => t.id)
  );
  if (links.length === 0) return templates;
  const visible = await resolveVisibleKnowledgeBases(
    ctx,
    links.map((l) => l.knowledgeBaseId)
  );
  const byId = new Map<string, TemplateKnowledgeBaseRef>(
    visible.map((kb) => [kb.id, kb])
  );
  const byTemplate = new Map<string, TemplateKnowledgeBaseRef[]>();
  for (const link of links) {
    const ref = byId.get(link.knowledgeBaseId);
    if (!ref) continue;
    byTemplate.set(link.templateId, [
      ...(byTemplate.get(link.templateId) ?? []),
      ref,
    ]);
  }
  return templates.map((t) => ({
    ...t,
    knowledgeBases: (byTemplate.get(t.id) ?? []).sort((a, b) =>
      a.name.localeCompare(b.name)
    ),
  }));
}
