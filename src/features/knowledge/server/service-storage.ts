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
 * THE PER-KB STORAGE GATE — the growth half of the storage meter.
 *
 * The COUNTER is not maintained here. `knowledge_bases.storage_bytes` is kept
 * in step by a row trigger on `knowledge_entries`
 * (`20260812120000_knowledge_base_storage_bytes.sql` §3), inside the same
 * transaction as the entry write, which is the only way a FK cascade — a folder
 * delete, a base delete — can be counted at all. This module owns the one
 * question that has to be answered BEFORE the write: may it grow.
 *
 * THE PLAN IS THE ENTITLEMENT VERDICT, never `workspace_billing.plan`. A solo
 * subscription that has grown a second member is degraded to free by
 * `entitlements.ts › paidEntitlement`, and reading the raw column would hand
 * that workspace 100 MB per base it is not entitled to. Two reads, same shape
 * as the credits path (`credits-service.ts › consumeMcpCredits`), and
 * deliberately NOT `getWorkspaceEntitlements` — its third query is a `COUNT(*)`
 * over `ontology_objects` that only the object cap reads.
 *
 * FREEZE, NEVER DELETE. Only a POSITIVE delta is checked. A shrinking edit on a
 * base that is already over its cap MUST succeed — that is the one action that
 * gets the workspace out of the hole, and a gate that blocked it would be a
 * trap rather than a limit.
 *
 * IT FAILS OPEN, ON PURPOSE, and the deploy order is why. The code reads a
 * column that exists only after the migration is applied; a web deploy that
 * lands first would otherwise refuse EVERY knowledge write in the product with
 * a billing error, which is a far worse outcome than a few uncounted megabytes.
 * The same reasoning the MCP registrar applies to a failed credit loopback: a
 * meter that cannot be read is not evidence of an over-cap workspace.
 */

/**
 * The per-base byte cap for a workspace, from its entitlement-resolved plan.
 *
 * `null` = UNKNOWN (the billing read failed), which every caller must treat as
 * "do not gate" and "do not render a bar" — never as zero and never as
 * unlimited.
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

/** The byte weight of an entry body, in the SAME unit the counter uses —
 *  `octet_length` over a UTF-8 database is `Buffer.byteLength(s, "utf8")`. */
export function bodyBytes(body: string | null | undefined): number {
  return body ? Buffer.byteLength(body, "utf8") : 0;
}

/**
 * Refuse a write that would push `base` past its plan's per-base cap.
 *
 * `deltaBytes` is the NET change this write makes to the base's stored bytes:
 * `bodyBytes(next) - bodyBytes(previous)` for an edit, `bodyBytes(next)` for a
 * create. A delta of zero or less returns immediately without touching the
 * database — a rename, a move, a reposition and a shrink all cost nothing here.
 */
export async function assertStorageHeadroom(
  ctx: KnowledgeContext,
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
    // The column or the billing row could not be read. Fail OPEN — see the
    // module header; the nightly re-sum is what corrects an uncounted write.
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
 * The flat plan-gate envelope for a refused write. Mirrors billing's
 * `entitlementDeniedBody` and chats' `chatRetentionDeniedBody` exactly —
 * `{ error: <code>, message, upgrade_url }` — because `@dopl/client` and the
 * MCP `respond.ts › entitlementDenied` path key off that shape, not off the
 * nested `HttpError` one.
 */
export function kbStorageDeniedBody(err: KnowledgeStorageLimitError) {
  return {
    error: err.code,
    message: err.message,
    upgrade_url: upgradeUrl(),
  };
}
