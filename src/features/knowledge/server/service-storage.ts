import "server-only";
import { kbStorageLimitForPlan } from "@/features/billing/kb-storage";
import { entitledPlanFor, upgradeUrl } from "@/features/billing/server/entitlements";
import {
  countActiveMembers,
  getWorkspaceBilling,
} from "@/features/billing/server/workspace-billing";
import { formatBytes } from "@/shared/lib/format-bytes";
import type { KnowledgeBase, KnowledgeContext } from "../types";
import { KnowledgeStorageLimitError } from "./errors";
import * as repo from "./repository";

/**
 * THE PER-KB STORAGE GATE. Answers one question BEFORE the write: may it grow.
 *
 * ⚠ The COUNTER is NOT maintained here — `knowledge_bases.storage_bytes` is
 * kept in step by a row trigger on `knowledge_entries`
 * (`20260812120000_knowledge_base_storage_bytes.sql` §3) in the same
 * transaction as the write, the only way FK cascades get counted at all.
 *
 * ⚠ PLAN = ENTITLEMENT VERDICT, never `workspace_billing.plan`: a solo
 * subscription grown to two members is degraded to free by `entitlements.ts ›
 * paidEntitlement`, and the raw column would hand it 100 MB/base it isn't
 * entitled to. Deliberately NOT `getWorkspaceEntitlements` — its third query is
 * a `COUNT(*)` over `ontology_objects` only the object cap reads.
 *
 * FREEZE, NEVER DELETE: only POSITIVE deltas checked, so a shrinking edit on an
 * over-cap base MUST succeed — the one action that gets the workspace out.
 *
 * ⚠ FAILS OPEN on purpose — it reads a column that exists only post-migration,
 * and a web deploy landing first would refuse EVERY knowledge write with a
 * billing error. An unreadable meter is not evidence of an over-cap workspace.
 */

/**
 * Per-base byte cap from the entitlement-resolved plan.
 * ⚠ `null` = UNKNOWN (billing read failed): callers must treat as "do not
 * gate" AND "do not render a bar" — never zero, never unlimited.
 */
export async function resolveKbStorageLimit(
  workspaceId: string
): Promise<number | null> {
  try {
    const [billing, memberCount] = await Promise.all([
      getWorkspaceBilling(workspaceId),
      countActiveMembers(workspaceId),
    ]);
    return kbStorageLimitForPlan(entitledPlanFor(billing, memberCount));
  } catch {
    return null;
  }
}

/** ⚠ Must stay the SAME unit as the counter: `octet_length` over a UTF-8
 *  database is `Buffer.byteLength(s, "utf8")`. */
export function bodyBytes(body: string | null | undefined): number {
  return body ? Buffer.byteLength(body, "utf8") : 0;
}

/**
 * Refuse a write that pushes `base` past its plan's per-base cap.
 *
 * `deltaBytes` = NET change: `bodyBytes(next) - bodyBytes(previous)` on edit,
 * `bodyBytes(next)` on create. Delta ≤ 0 returns without touching the DB —
 * renames, moves, repositions and shrinks cost nothing.
 *
 * ⚠ TAKES `Pick<KnowledgeContext, "workspaceId">` RATHER THAN THE WHOLE CONTEXT
 * (widened 2026-08-26 for the channel lane, whose `ChannelKnowledgeContext`
 * deliberately carries no `role`). The narrow type is a claim the compiler
 * checks: this is a PLAN gate, it asks the workspace's billing one question, and
 * it must never grow into reading a caller's role and answering a visibility
 * question with it. Every existing caller passes a full `KnowledgeContext` and
 * is unaffected.
 */
export async function assertStorageHeadroom(
  ctx: Pick<KnowledgeContext, "workspaceId">,
  base: KnowledgeBase,
  deltaBytes: number
): Promise<void> {
  if (deltaBytes <= 0) return;

  let used: number | null;
  let limit: number | null;
  try {
    [used, limit] = await Promise.all([
      repo.getBaseStorageBytes(ctx.workspaceId, base.id),
      resolveKbStorageLimit(ctx.workspaceId),
    ]);
  } catch {
    // Column or billing row unreadable. Fail OPEN (module header); the
    // nightly re-sum corrects an uncounted write.
    return;
  }
  if (used === null || limit === null) return;
  if (used + deltaBytes <= limit) return;

  throw new KnowledgeStorageLimitError(
    base.id,
    used,
    limit,
    deltaBytes,
    `"${base.name}" has reached its ${formatBytes(limit)} storage limit ` +
      `(${formatBytes(used)} used). Nothing has been deleted — everything stays ` +
      `readable, editable and deletable, and a smaller edit still saves. Upgrade ` +
      `for more room, or remove some files from this knowledge base.`
  );
}

/**
 * Flat plan-gate envelope for a refused write. ⚠ Must mirror billing's
 * `entitlementDeniedBody` and chats' `chatRetentionDeniedBody` EXACTLY —
 * `{ error, message, upgrade_url }` — because `@dopl/client` and MCP
 * `respond.ts › entitlementDenied` key off that shape, not the nested
 * `HttpError` one.
 */
export function kbStorageDeniedBody(err: KnowledgeStorageLimitError) {
  return {
    error: err.code,
    message: err.message,
    upgrade_url: upgradeUrl(),
  };
}
