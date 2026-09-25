import "server-only";
import type { BillingTarget } from "./credits-service";
import type { WorkspaceBillingRow } from "./workspace-billing";

/**
 * The three `BillingTarget` shapes, built once — the meter suite and the rule-B
 * attribution suite both assert against them.
 *
 * Rule B added `channelId` (the calling channel whose container is charged,
 * `null` for a channel-less call) and, on the personal arm,
 * `personalBillingContainerId` — the container to read the billing row from,
 * which is the container itself only when it is `kind='home'`. A link
 * container carries no row, so its wallet reaches the tier through the payer.
 *
 * Not a test file (no `describe`) — the `*-fixtures.ts` naming convention.
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

export function homeSpaceTarget(over: {
  workspaceId: string;
  payerUserId: string;
  channelId?: string | null;
  /** Pass the container id ONLY for a `kind='home'` container. */
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

/**
 * THE LEDGER ATTRIBUTION the two consume RPCs take as their TRAILING argument
 * since 2026-09-13 — the `credit_usage_events` row each one writes in the
 * counter's own transaction (`credit-ledger.ts › CreditLedgerAttribution`; F-693,
 * Samuel: *"the histogram must equal the wallet, always"*).
 *
 * `originWorkspaceId` is the ADDRESSED container — the id passed to
 * `consumeMcpCredits` — never the charged one. `callerUserId` is who called, not
 * the payer; they differ on the guest path, and the payer is the counter's key.
 * Shared rather than re-declared per suite: four suites assert against this
 * shape, and a second copy is how two of them come to disagree.
 */
export function ledgerAttribution(
  originWorkspaceId: string,
  callerUserId: string | null,
  channelId: string | null = null
) {
  return { originWorkspaceId, callerUserId, channelId };
}

/**
 * A LIVE TEAM `workspace_billing` ROW — the starting fixture four credit suites
 * override (`credits-service`, `credits-service-window`, `credits-link-reroute`,
 * `credits-channel-attribution`).
 *
 * One definition: the per-suite copies had already drifted on the period anchors,
 * the field the window cases turn on.
 *
 * The anchors default to `null` (a free-shaped window) while the plan is paid,
 * deliberately: a suite that cares about the subscription window must say so, and
 * one that does not must not silently inherit one.
 */
export function teamBillingRow(
  over: Partial<WorkspaceBillingRow> = {}
): WorkspaceBillingRow {
  return {
    workspaceId: "ws-1",
    plan: "team",
    status: "active",
    stripeCustomerId: "cus_1",
    stripeSubscriptionId: "sub_1",
    stripePriceId: "price_seat",
    seatCount: 3,
    currentPeriodStart: null,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    lastStripeEventCreated: null,
    ...over,
  };
}
