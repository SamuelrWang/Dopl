import "server-only";
import { slugify } from "@/shared/lib/slug/slugify";
import type { Role } from "@/features/workspaces/types";
import {
  effectiveResourceAccess,
  listEffectiveAccess,
  requireEffectiveAccess,
  resolveLevel,
} from "@/features/teams/server/access";
import type { KnowledgeBase, KnowledgeContext } from "../types";
import {
  AgentWriteDisabledError,
  KnowledgeBaseMismatchError,
  KnowledgeBaseNotFoundError,
} from "./errors";
import * as repo from "./repository";

/**
 * Shared internals for the knowledge service. Cross-cutting gates and
 * helpers used by more than one of the per-domain service modules
 * (`service-bases`, `service-base-writes`, `service-folders`,
 * `service-entries`, `service-paths`, `service-seed`).
 *
 * The repository (`./repository.ts`) does raw I/O and bypasses RLS via
 * the service-role client — so every method that reaches a row MUST
 * filter by `ctx.workspaceId` (or chase a row up to a base and verify
 * scope) to stop cross-workspace leakage.
 */

// ─── Context construction ───────────────────────────────────────────

export interface AuthLike {
  userId: string;
  workspaceId: string;
  role: Role;
  agentTokenId?: string | null;
  apiKeyWorkspaceId?: string | null;
}

/**
 * Translates a `withWorkspaceAuth` (or MCP equivalent) auth result into
 * a `KnowledgeContext`. Source is derived from the presence of an API
 * key — session callers are users; API-key callers are agents. The
 * key's workspace lock (if any) is forwarded so the service layer can
 * enforce M-10 visibility rules.
 */
export function buildKnowledgeContext(auth: AuthLike): KnowledgeContext {
  return {
    workspaceId: auth.workspaceId,
    userId: auth.userId,
    role: auth.role,
    source: auth.agentTokenId ? "agent" : "user",
    apiKeyWorkspaceId: auth.apiKeyWorkspaceId ?? null,
  };
}

// ─── Visibility gates ───────────────────────────────────────────────

/**
 * M-10 visibility filter — true if the caller can see this KB based
 * on its visibility, ownership, and the API-key scope:
 *   - Public items: always visible.
 *   - Private items via session or personal API key: owner-only.
 *   - Private items via workspace-scoped API key: never visible
 *     (those keys may be shared between humans).
 *
 * Used both as a row-level filter (`listBases`) and as a 404 gate
 * (`getBaseById` / `getBaseBySlug` / `getBaseByPublicId`).
 */
export function canSeeBase(ctx: KnowledgeContext, base: KnowledgeBase): boolean {
  if (base.visibility === "public") return true;
  if (ctx.apiKeyWorkspaceId) return false;
  return base.createdBy === ctx.userId;
}

/**
 * Full visibility gate for single-base reads: M-10 visibility rules plus
 * team scoping — a teams-mode base is 404 for members outside every
 * granted team (admins and the creator always pass).
 */
export async function assertBaseVisible(
  ctx: KnowledgeContext,
  base: KnowledgeBase
): Promise<void> {
  if (!canSeeBase(ctx, base)) throw new KnowledgeBaseNotFoundError(base.id);
  if (base.accessMode !== "teams") return;
  const level = await effectiveResourceAccess(
    ctx.userId,
    ctx.workspaceId,
    "knowledge_base",
    base.id,
    { role: ctx.role }
  );
  if (level === null) throw new KnowledgeBaseNotFoundError(base.id);
}

/**
 * Team-scope list filter: drops teams-mode bases the caller can't read.
 * One batch query regardless of base count; workspace-mode bases pass
 * through untouched.
 */
export async function filterTeamVisibleBases(
  ctx: KnowledgeContext,
  bases: KnowledgeBase[]
): Promise<KnowledgeBase[]> {
  if (!bases.some((b) => b.accessMode === "teams")) return bases;
  const acc = await listEffectiveAccess(ctx.workspaceId, ctx.userId, {
    role: ctx.role,
  });
  if (!acc) return [];
  return bases.filter(
    (b) => resolveLevel(acc, "knowledge_base", b.id, b.accessMode) !== null
  );
}

// ─── Write enforcement ──────────────────────────────────────────────

/**
 * Gate for KB writes from EVERY source (web sessions included). Team
 * grants are the source of truth: owner/admin and the creator always
 * pass; on a teams-mode base other members need an `edit` grant via one
 * of their teams; on a workspace-mode base the role default applies
 * (member → edit, viewer → read-only).
 *
 * `AgentWriteDisabledError` is still thrown when an agent tries to flip
 * `agentWriteEnabled` itself in updateBase — that path doesn't call
 * here.
 */
export async function assertBaseWritable(
  ctx: KnowledgeContext,
  base: KnowledgeBase
): Promise<void> {
  // `agent_write_enabled=false` makes a base read-only to AGENTS; human
  // web-UI callers (source="user") are unaffected. Enforce it on the
  // write path, not just deletes (F-10b) — the flag was advertised in the
  // MCP surface + docstrings but only the team-access matrix was checked
  // here, so an agent with team "edit" could still overwrite a base
  // flagged read-only. Read-only wins over team access.
  if (ctx.source === "agent" && !base.agentWriteEnabled) {
    throw new AgentWriteDisabledError(base.id);
  }
  await requireEffectiveAccess(
    ctx.userId,
    ctx.workspaceId,
    "knowledge_base",
    base.id,
    "edit",
    { role: ctx.role }
  );
}

/**
 * Delete gate for agent callers (F-10). A base flagged
 * `agent_write_enabled = false` is READ-ONLY to agents, so the destructive
 * soft-deletes (base / folder / entry) must honor the toggle the same way
 * content writes do. The audit hole was that only the write path checked
 * the flag — the admin deletes didn't, so an agent could trash a base
 * flagged read-only (it deleted the seeded "Dopl Guide" KB this way).
 *
 * Only `ctx.source === "agent"` is gated; human (web-UI) deletes always
 * pass. Reuses `AgentWriteDisabledError` → 403 AGENT_WRITE_DISABLED, the
 * same shape/error the blocked agent writes already surface.
 */
export function assertAgentCanDelete(
  ctx: KnowledgeContext,
  base: KnowledgeBase
): void {
  if (ctx.source === "agent" && !base.agentWriteEnabled) {
    throw new AgentWriteDisabledError(
      base.id,
      "This knowledge base is read-only to agents (agent_write_enabled=false) — delete it from the Dopl web UI."
    );
  }
}

// ─── Shared helpers ─────────────────────────────────────────────────

export async function listSlugs(workspaceId: string): Promise<string[]> {
  return repo.listBaseSlugsForWorkspace(workspaceId);
}

export function deriveSlug(input: string, taken: string[]): string {
  return slugify(input, "knowledge-base", taken);
}

export function assertSameWorkspace(
  rowWorkspaceId: string,
  ctxWorkspaceId: string,
  description: string
): void {
  if (rowWorkspaceId !== ctxWorkspaceId) {
    throw new KnowledgeBaseMismatchError(
      `${description} belongs to a different workspace`
    );
  }
}

export function errorCode(err: unknown): string | null {
  if (err && typeof err === "object" && "code" in err) {
    return (err as { code?: string }).code ?? null;
  }
  return null;
}
