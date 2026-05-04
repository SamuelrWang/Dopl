import "server-only";
import { notFound, redirect } from "next/navigation";
import { logSystemEvent } from "@/features/analytics/server/system-events";
import { parseSegment } from "@/shared/lib/url/parse-segment";
import type { KnowledgeBase, KnowledgeContext } from "../types";
import { knowledgeBaseSegment } from "../url";
import { workspaceSegment } from "@/features/workspaces/url";
import { KnowledgeBaseNotFoundError } from "./errors";
import * as repo from "./repository";

export interface ResolvedKbSegment {
  base: KnowledgeBase;
  /** Canonical `{slug}-{publicId}` segment for this KB. */
  canonical: string;
  /** True when the inbound segment didn't match canonical — caller should 301. */
  needsRedirect: boolean;
}

/**
 * Resolve a `{kbSlug}` URL parameter into a knowledge base. Accepts the
 * canonical `{slug}-{publicId}` form and legacy slug-only URLs.
 *
 * Slug uniqueness within workspace is still enforced at the DB layer
 * because MCP tools address bases by slug — so the legacy fallback
 * remains a deterministic single-row lookup.
 *
 * Returns null when neither path resolves. Callers decide 301 / 404 /
 * render based on `needsRedirect`.
 */
export async function resolveKbSegment(
  ctx: KnowledgeContext,
  segment: string
): Promise<ResolvedKbSegment | null> {
  const parsed = parseSegment(segment);
  if (parsed) {
    const base = await repo.findBaseByPublicId(
      ctx.workspaceId,
      parsed.publicId,
      false
    );
    if (base) {
      const canonical = knowledgeBaseSegment(base);
      return { base, canonical, needsRedirect: segment !== canonical };
    }
  }
  const legacy = await repo.findBaseBySlug(ctx.workspaceId, segment, false);
  if (legacy) {
    void logSystemEvent({
      severity: "info",
      category: "other",
      source: "legacy_slug_redirect",
      message: `Legacy KB slug URL hit: ${segment}`,
      fingerprintKeys: ["legacy_slug_redirect", "kb", legacy.publicId],
      metadata: { workspace_id: ctx.workspaceId, kb_id: legacy.id, slug: segment },
      userId: ctx.userId,
    });
    return {
      base: legacy,
      canonical: knowledgeBaseSegment(legacy),
      needsRedirect: true,
    };
  }
  return null;
}

/**
 * Page-level wrapper. 404s on miss, 301s on stale segment, otherwise
 * returns the resolved base. Takes the canonical workspace segment
 * (already verified by `resolvePageWorkspace`) so the redirect target
 * stays canonical at both levels.
 */
export async function resolvePageKb(
  ctx: KnowledgeContext,
  workspaceCanonical: string,
  segment: string
): Promise<KnowledgeBase> {
  const resolved = await resolveKbSegment(ctx, segment);
  if (!resolved) notFound();
  if (resolved.needsRedirect) {
    redirect(`/${workspaceCanonical}/knowledge/${resolved.canonical}`);
  }
  return resolved.base;
}

/**
 * Page-level wrapper that takes a workspace `{slug, publicId}` shape
 * and computes the canonical workspace segment internally.
 */
export async function resolvePageKbWithWorkspace(
  ctx: KnowledgeContext,
  workspace: { slug: string; publicId: string },
  segment: string
): Promise<KnowledgeBase> {
  return resolvePageKb(ctx, workspaceSegment(workspace), segment);
}

// Re-export so route files only need one import point.
export { KnowledgeBaseNotFoundError };
