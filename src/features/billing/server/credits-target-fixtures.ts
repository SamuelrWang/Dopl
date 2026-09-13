import "server-only";
import type { BillingTarget } from "./credits-service";
import type { WorkspaceBillingRow } from "./workspace-billing";

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

/**
 * THE LEDGER ATTRIBUTION the two consume RPCs take as their TRAILING argument
 * since 2026-09-13 — the `credit_usage_events` row each one writes in the
 * counter's own transaction (`credit-ledger.ts › CreditLedgerAttribution`; F-693,
 * Samuel: *"the histogram must equal the wallet, always"*).
 *
 * ⚠ **`originWorkspaceId` IS THE ADDRESSED CONTAINER**, i.e. the id the case
 * passed to `consumeMcpCredits` — never the CHARGED one, which is the RPC's own
 * leading argument on the seat arm and where the wallet lives on the personal one.
 * ⚠ **`callerUserId` IS WHO CALLED, NOT THE PAYER.** They differ exactly on the
 * guest path, and they now ride two different arguments: the payer is the
 * counter's key, the caller is here.
 * ⚠ Shared rather than re-declared per suite, for the reason this whole module
 * exists: four suites assert against this shape, and a second copy is how two of
 * them come to disagree about what one row looks like.
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
 * ⚠ **ONE DEFINITION, FOR THE REASON THIS MODULE EXISTS.** Each of those files
 * carried its own 13-line copy; the copies had already drifted on the period
 * anchors, which is the field the window cases turn on — so "the team row" meant
 * two different things depending on which suite you were reading.
 *
 * ⚠ **THE ANCHORS DEFAULT TO `null` (a free-shaped window) AND THE PLAN IS PAID**,
 * which is deliberate: a suite that cares about the subscription window must SAY
 * so, and a suite that does not must not silently inherit one.
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
