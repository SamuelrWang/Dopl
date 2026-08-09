import "server-only";
import type { AgentTrustRule } from "../types";
import {
  TrustedNotMemberError,
  TrustSelfError,
} from "./errors";
import { mapTrustRow, type TrustRuleRow } from "./collab-dto";
import * as repo from "./repository";
import * as collab from "./repository-collab";
import { profilesById, type ChannelContext } from "./service-shared";

/**
 * Trust service — per-teammate standing consent, scoped to the caller
 * (operator) in the active workspace. A rule auto-allows INBOUND requests
 * from that teammate's agent; it never affects outbound review. Every op is
 * self-only: the operator is always `ctx.userId`, never a body field.
 */

async function hydrate(rows: TrustRuleRow[]): Promise<AgentTrustRule[]> {
  const profiles = await profilesById(rows.map((r) => r.trusted_user_id));
  return rows.map((row) => mapTrustRow(row, profiles.get(row.trusted_user_id)));
}

export async function listTrustRules(ctx: ChannelContext): Promise<AgentTrustRule[]> {
  const rows = await collab.listTrustRules(ctx.userId, ctx.workspaceId);
  return hydrate(rows);
}

/**
 * Does a standing rule cover this requester RIGHT NOW? Membership is checked
 * at consumption, not just at creation: a rule outlives the teammate leaving
 * the workspace (nothing sweeps `agent_trust_rules` on removal), so trusting
 * the stored row alone would keep auto-allowing an ex-colleague's agent — and
 * would silently re-arm if they were ever re-added under the same account.
 * Trust is a statement about a current teammate; both halves must hold.
 */
export async function isTrustedRequester(
  ctx: ChannelContext,
  requesterUserId: string
): Promise<boolean> {
  const rule = await collab.findTrustRule(
    ctx.userId,
    requesterUserId,
    ctx.workspaceId
  );
  if (!rule) return false;
  return repo.isActiveWorkspaceMember(ctx.workspaceId, requesterUserId);
}

/**
 * Add a standing trust rule for a teammate. Refuses self-trust (meaningless)
 * and a non-member target; idempotent on the (operator, trusted, workspace)
 * unique key so a double-add converges on the existing rule.
 */
export async function createTrustRule(
  ctx: ChannelContext,
  trustedUserId: string
): Promise<AgentTrustRule> {
  if (trustedUserId === ctx.userId) throw new TrustSelfError();
  if (!(await repo.isActiveWorkspaceMember(ctx.workspaceId, trustedUserId))) {
    throw new TrustedNotMemberError(trustedUserId);
  }

  const existing = await collab.findTrustRule(
    ctx.userId,
    trustedUserId,
    ctx.workspaceId
  );
  if (existing) return (await hydrate([existing]))[0];

  let row: TrustRuleRow;
  try {
    row = await collab.insertTrustRule({
      operator_user_id: ctx.userId,
      trusted_user_id: trustedUserId,
      workspace_id: ctx.workspaceId,
    });
  } catch (err) {
    // Lost the idempotency race — converge on the stored winner.
    if (repo.pgErrorCode(err) === "23505") {
      const raced = await collab.findTrustRule(
        ctx.userId,
        trustedUserId,
        ctx.workspaceId
      );
      if (raced) return (await hydrate([raced]))[0];
    }
    throw err;
  }
  return (await hydrate([row]))[0];
}

/**
 * Remove a trust rule (idempotent no-op when it doesn't exist).
 *
 * Deleting the rule is the WHOLE revocation — there is deliberately no sweep
 * of the `auto_allowed` consent rows it already produced (C-19). Those rows
 * are re-verified against this table at consumption by
 * `consent-service.revalidateAutoAllow`, which fails closed on a missing rule
 * AND on a requester who has left the workspace. A sweep here would catch only
 * the first of those two, and could not tell an in-flight row from one whose
 * work already ran — it would rewrite the audit trail those rows exist to be.
 */
export async function deleteTrustRule(
  ctx: ChannelContext,
  trustedUserId: string
): Promise<void> {
  await collab.deleteTrustRule(ctx.userId, trustedUserId, ctx.workspaceId);
}
