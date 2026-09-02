import "server-only";
import { isSharedCredential } from "@/shared/auth/credential-audience";
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
 * Cross-cutting gates + helpers shared by the per-domain service modules.
 *
 * ⚠ `./repository.ts` bypasses RLS via the service-role client, so every
 * method reaching a row MUST filter by `ctx.workspaceId` (or chase the row up
 * to a base and verify scope) or workspaces leak into each other.
 */

// ─── Context construction ───────────────────────────────────────────

export interface AuthLike {
  userId: string;
  workspaceId: string;
  role: Role;
  agentTokenId?: string | null;
  apiKeyWorkspaceId?: string | null;
  /** WHOSE REACH the credential inherits; `null` = nobody in particular.
   *  ⚠ REQUIRED — this axis has no safe default (F-336). */
  credentialSubjectUserId: string | null;
  sessionId?: string | null;
}

/**
 * `withWorkspaceAuth` (or MCP equivalent) result → `KnowledgeContext`. Source
 * derives from API-key presence: session = user, API key = agent. The key's
 * workspace lock is forwarded so the service can enforce M-10 visibility.
 *
 * ⚠ `sessionId` is forwarded VERBATIM and is the one forgeable field on the
 * result. It exists for `service-audience.ts › narrowToSessionChannel`, which
 * may only use it to NARROW an already-fenced channel set; the field's own
 * docblock on `KnowledgeContext` carries the rule. Every route already hands
 * this function the whole `withWorkspaceAuth` context, so it arrives with no
 * per-route edit — which is also why nothing may start granting on it.
 */
export function buildKnowledgeContext(auth: AuthLike): KnowledgeContext {
  return {
    workspaceId: auth.workspaceId,
    userId: auth.userId,
    role: auth.role,
    source: auth.agentTokenId ? "agent" : "user",
    apiKeyWorkspaceId: auth.apiKeyWorkspaceId ?? null,
    credentialSubjectUserId: auth.credentialSubjectUserId,
    sessionId: auth.sessionId ?? null,
  };
}

// ─── Visibility gates ───────────────────────────────────────────────

/**
 * M-10 visibility. Public → always; private → owner-only; private via a SHARED
 * credential → NEVER. Used as row filter (`listBases`) AND 404 gate
 * (`getBaseById` / `getBaseBySlug` / `getBaseByPublicId`).
 *
 * 🔒 ⚠ ARM 2 ASKS `isSharedCredential`, NOT "IS THERE A WORKSPACE LOCK?", AND
 * THE DIFFERENCE IS F-336 (fixed 2026-08-27, Samuel's ruling). This line read
 * `if (ctx.apiKeyWorkspaceId) return false`, which turned layer B1's WORKSPACE
 * fence into a VISIBILITY fence: a container-locked session — the operator's own
 * agent, on the operator's own user id — was refused every non-public base
 * **before** `service-audience.ts`'s grant fence was ever consulted, so a
 * private base granted `agent_only` into the channel was still a 404 and the
 * grant switch was decoration. The two layers own different axes: **B1 decides
 * WHICH WORKSPACE, layer A decides WHICH BASE WITHIN IT.** This predicate owns
 * neither — it decides whether a credential stands for a person.
 *
 * ⚠ NOTHING HERE WIDENS THE CONTAINER. `getBaseById`/`getBaseBySlug`/`listBases`
 * still run `resolveAgentAudience` after this, so an agent in a shared container
 * reaches an ungranted base — private or public — exactly never.
 *
 * ⚠ MIRRORED, NOT IMPORTED, IN FOUR PLACES: `chats › canSeeChat`,
 * `skills › canSeeSkill`, `agent-templates › canSeeTemplate` and
 * `agent-templates › canSeeBaseRow`. All five moved together in this change;
 * splitting them is how the rule drifts.
 */
export function canSeeBase(ctx: KnowledgeContext, base: KnowledgeBase): boolean {
  if (base.visibility === "public") return true;
  if (isSharedCredential(ctx)) return false;
  return base.createdBy === ctx.userId;
}

/** Single-base read gate: M-10 rules + team scoping. Teams-mode base is 404
 *  for members outside every granted team; admins and creator always pass. */
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

/** Drops teams-mode bases the caller can't read. One batch query regardless
 *  of base count; workspace-mode bases pass through. */
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
 * KB write gate for EVERY source, web sessions included. Team grants are the
 * source of truth: owner/admin/creator pass; teams-mode members need an `edit`
 * grant; workspace-mode uses the role default (member → edit, viewer → read).
 * ⚠ updateBase does NOT route here for `agentWriteEnabled` flips — it throws
 * `AgentWriteDisabledError` itself.
 */
export async function assertBaseWritable(
  ctx: KnowledgeContext,
  base: KnowledgeBase
): Promise<void> {
  // ⚠ `agent_write_enabled=false` = read-only to AGENTS only; source="user"
  // unaffected. Must be checked on the WRITE path, not just deletes (F-10b):
  // team-access alone let an agent with team "edit" overwrite a read-only
  // base. Read-only wins over team access.
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
 * F-10 delete gate. `agent_write_enabled = false` is READ-ONLY to agents, so
 * base/folder/entry deletes honor the toggle like content writes do.
 * Only `ctx.source === "agent"` gated; human deletes always pass. Reuses
 * `AgentWriteDisabledError` → 403 AGENT_WRITE_DISABLED for shape parity.
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
