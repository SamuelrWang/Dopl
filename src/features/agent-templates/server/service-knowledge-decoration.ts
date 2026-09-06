import "server-only";
import type {
  AgentTemplate,
  AgentTemplateContext,
  TemplateKnowledgeBaseRef,
} from "../types";
import * as repo from "./repository";
import { resolveVisibleKnowledgeBases } from "./service-shared";

/**
 * THE KB DECORATION, lifted out of `service-reads.ts` on 2026-09-05 when the
 * reach count pushed that file into the 500-line hard cap (`eslint.config.mjs ›
 * max-lines`, ENGINEERING.md §2).
 *
 * ⚠ IT IS A SECTION, NOT A LAYER — the move
 * `repository-knowledge-links.ts` already made one layer down, on the same seam
 * and for the same reason. `service-reads.ts` owns WHICH ROWS A CALLER MAY SEE;
 * this owns WHAT THE ATTACHMENTS ON THEM RESOLVE TO. Its only caller is that
 * file, and it imports nothing from it, so the arrow points one way.
 */

/**
 * Side-load KB refs onto a visible row set — ONE junction query plus the
 * visibility resolution, regardless of row count.
 * ⚠ Filtered through the SAME `resolveVisibleKnowledgeBases` the attach gate
 * uses, so a base that was attachable when it was attached and has since gone
 * private simply disappears from the payload rather than leaking its name.
 *
 * ⚠ **SINCE 2026-09-05 THE DISAPPEARANCE IS COUNTED** (Samuel's ruling). The
 * filter above is right and stays, but it used to be SILENT: a base attached in
 * one container and launched in another left no trace at all, so the agent read
 * a role naming no knowledge and could not report a gap it was never told about.
 * `unreachableKnowledgeBaseCount` is that trace, and it is A COUNT AND NOTHING
 * ELSE — no id, no name, no container — because the desktop turns it into prompt
 * text (`prompt-framing-template.js › unreachableKnowledgeLines`) and a location
 * would land there. It never blocks a launch: the agent starts, minus the base.
 */
export async function decorateWithKnowledgeBases(
  ctx: AgentTemplateContext,
  templates: AgentTemplate[]
): Promise<AgentTemplate[]> {
  if (templates.length === 0) return [];
  const links = await repo.listKnowledgeLinksForTemplates(
    ctx.workspaceId,
    templates.map((t) => t.id)
  );
  // ⚠ NO LINKS IS A DECIDED ZERO, not an absence. The row went through the
  // decoration and the answer is "nothing was dropped"; leaving the field
  // undefined here would make an unattached template indistinguishable from an
  // undecorated one for every consumer downstream.
  if (links.length === 0) {
    return templates.map((t) => ({ ...t, unreachableKnowledgeBaseCount: 0 }));
  }
  const visible = await resolveVisibleKnowledgeBases(
    ctx,
    links.map((l) => l.knowledgeBaseId)
  );
  const byId = new Map<string, TemplateKnowledgeBaseRef>(
    visible.map((kb) => [kb.id, kb])
  );
  const byTemplate = new Map<string, TemplateKnowledgeBaseRef[]>();
  // ⚠ COUNTED HERE, WHERE THE DROP HAPPENS, AND NOWHERE ELSE. This loop is the
  // only place that knows both numbers; asking "how many did I lose" anywhere
  // downstream would mean a second read against the base rows, which is the
  // probe the no-location rule forbids.
  const droppedByTemplate = new Map<string, number>();
  for (const link of links) {
    const ref = byId.get(link.knowledgeBaseId);
    if (!ref) {
      droppedByTemplate.set(
        link.templateId,
        (droppedByTemplate.get(link.templateId) ?? 0) + 1
      );
      continue;
    }
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
    unreachableKnowledgeBaseCount: droppedByTemplate.get(t.id) ?? 0,
  }));
}
