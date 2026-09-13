import "server-only";
import type { BillingTarget } from "./credits-service";

/**
 * THE THREE `BillingTarget` SHAPES, BUILT ONCE — the meter suite and the rule-B
 * attribution suite both assert against them.
 *
 * ⚠ **RULE B PUT TWO MORE FIELDS ON EVERY TARGET (2026-09-13)**: `channelId` (the
 * CALLING CHANNEL whose container is charged, `null` for a channel-less call) and,
 * on the personal arm, `personalBillingContainerId` — the container to read the
 * billing row from, which is the container ITSELF only when it is
 * `kind='personal'`. A link container carries no row, so its wallet reaches the
 * tier through the PAYER. Spelled here rather than inline so a THIRD field lands
 * in one place instead of a dozen.
 *
 * ⚠ NOT a test file (no `describe`) — the naming convention this directory's
 * `*-fixtures.ts` siblings already follow.
 */
export function seatTarget(over: {
  workspaceId: string;
  payerUserId: string;
  channelId?: string | null;
}): BillingTarget {
  return {
    wallet: "seat",
    workspaceId: over.workspaceId,
    payerUserId: over.payerUserId,
    channelId: over.channelId ?? null,
  };
}

export function personalTarget(over: {
  workspaceId: string;
  payerUserId: string;
  channelId?: string | null;
  /** Pass the container id ONLY for a `kind='personal'` container. */
  personalBillingContainerId?: string | null;
}): BillingTarget {
  return {
    wallet: "personal",
    workspaceId: over.workspaceId,
    payerUserId: over.payerUserId,
    channelId: over.channelId ?? null,
    personalBillingContainerId: over.personalBillingContainerId ?? null,
  };
}

export function unmeteredTarget(workspaceId: string): BillingTarget {
  return {
    wallet: null,
    workspaceId,
    payerUserId: null,
    channelId: null,
    reason: "container-has-no-active-owner",
  };
}
