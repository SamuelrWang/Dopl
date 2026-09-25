import "server-only";
import type { WorkspaceKind } from "@/features/workspaces/types";
import { getWorkspaceEntitlements } from "./entitlements";
import { unmeteredSince } from "./credits-unmetered";
import { ledgerDriftFor } from "./credits-audit";
import { readPersonalBilling } from "./personal-wallet";
import { getWorkspaceBilling } from "./workspace-billing";
import {
  resolveBillingTarget,
  type BillingTarget,
  type CreditCaller,
  type CreditsSummary,
} from "./credits-service";
import {
  summarizeCredits,
  // The same zeroes the consume path returns, from one definition: two copies of
  // "the degraded reading" is how one surface omits the `degraded` stamp.
  unmeteredSummary,
} from "./credits-meter";

/**
 * `GET /api/billing/status` payload, assembled here so the route stays thin
 * (§2) and the shape has ONE server-side definition.
 *
 * Must stay in sync with its client mirror
 * `features/billing/components/use-workspace-entitlements.ts ›
 * WorkspaceEntitlementsStatus` — edit both together.
 *
 * `subscription_period_end` / `has_stripe_customer` keep their snake/flat legacy
 * names: already on the wire, read by shipped clients. `containerKind` landed
 * 2026-09-08 because two plan taxonomies exist (`../plans.ts › plansForKind`)
 * and `free` is a value on both lists.
 */
/**
 * The meter, plus the RECONCILIATION verdict for the wallet it read.
 *
 * `ledgerDrift` is on the status payload and nothing else (2026-09-13, F-693):
 * `CreditsSummary` is shared with `CreditConsumeResult`, the body
 * `POST /api/mcp/credits/consume` returns to the MCP server. Extending here
 * rather than there keeps that response byte-identical.
 */
export interface StatusCredits extends CreditsSummary {
  /**
   * `counter - SUM(ledger)` for this wallet and period. **0 = reconciled**, which
   * is what every row written after
   * `20261004120000_credit_consume_with_ledger.sql` must be, and what an
   * unreadable reconciliation also reports (`credits-audit.ts › ledgerDriftFor`
   * degrades with a warn — the migration ships unapplied).
   *
   * New on the wire, so the client mirror needs a `?? 0` (INVARIANTS §8): the
   * IndexedDB-persisted query cache replays rows stored before this field
   * shipped. `components/use-workspace-entitlements.ts` defaults it field-wise
   * inside `credits`, and a stale-cache case pins it.
   */
  ledgerDrift: number;
  /**
   * When this server process first failed open on a charge and has not recovered
   * since — ISO-8601, or `null` when metering normally (2026-09-14). The consume
   * route fails OPEN by decision, so a dead RPC runs the estate unmetered while
   * both meters show the `0` of a measured empty month; this tells those apart.
   *
   * Process-local, a stated limitation (`./credits-unmetered.ts` carries it in
   * full): a `null` means only "not this instance". It is not `degraded`, which
   * is a posture about the answer just computed rather than a fault in the charge
   * path.
   *
   * New on the wire, so the client mirror needs a `?? null` (INVARIANTS §8): the
   * IndexedDB-persisted query cache replays rows stored before this field
   * shipped. `components/use-workspace-entitlements.ts` defaults it field-wise
   * inside `credits`, and a stale-cache case pins it.
   */
  unmeteredSince: string | null;
}

/** The meter as `callerCredits` builds it. `unmeteredSince` is stamped once at
 *  the top because it is a fact about the PROCESS, not about the wallet any arm
 *  read — stamping it per arm is how one arm comes to omit it. */
type WalletCredits = Omit<StatusCredits, "unmeteredSince">;

export interface WorkspaceBillingStatusPayload {
  /**
   * The ENTITLED plan of the addressed container. On a `kind='home'` one it
   * is `pro` or `free` and never `team` (2026-09-08): a surface rendering plan
   * cards must pick the list by `containerKind`, not guess from this value.
   */
  plan: string;
  status: string;
  /**
   * WHICH KIND OF CONTAINER these entitlements describe — the field that tells
   * a renderer whether it is looking at a workspace (seats, members, Team) or
   * somebody's home space (flat, one member, Pro).
   *
   * New 2026-09-08, so the client mirror needs a fallback (INVARIANTS §8): the
   * IndexedDB-persisted query cache replays rows stored before this field
   * shipped. `use-workspace-entitlements.ts` defaults it to `"standard"` — the
   * same default `workspaces/types.ts › isStandardWorkspace` takes for an absent
   * kind — and a stale-cache case pins it.
   */
  containerKind: WorkspaceKind;
  memberCount: number;
  seatCount: number | null;
  objectCap: number | null;
  objectsUsed: number;
  canCreateObjects: boolean;
  chatsWindowDays: number | null;
  /** THE CALLER'S OWN credit meter for the current period — their seat, or
   *  their personal wallet. Every caller has one. */
  credits: StatusCredits;
  /** Live now, will not renew (Stripe's `cancel_at_period_end`). */
  cancelAtPeriodEnd: boolean;
  subscription_period_end: string | null;
  has_stripe_customer: boolean;
}

/**
 * The meter is the caller's own wallet and only ever theirs (2026-09-07). A
 * member reads their seat, a container owner their personal wallet; a PEER
 * inside somebody's link container reads the unmetered posture, because that
 * wallet spans every relationship the owner has.
 *
 * This path passes NO `channelId` to `resolveBillingTarget`, deliberately (rule
 * B, 2026-09-13): a meter is a question about the container a person is looking
 * at, not about a session that is spending, so the resolver answers the ADDRESSED
 * container and the entitlements half reads the workspace the caller is already
 * authorized into. Adding a channel here would print a wallet the surrounding
 * plan/member/seat block does not describe.
 *
 * For a container the entitlements block therefore describes the CONTAINER (free
 * plan, its own member count, no objects) rather than a workspace the owner also
 * owns: a container carries no plan, and the credits are on a wallet.
 */
export async function getWorkspaceBillingStatus(
  workspaceId: string,
  caller: CreditCaller
): Promise<WorkspaceBillingStatusPayload> {
  const resolved = await resolveBillingTarget(workspaceId, caller);
  const [entitlements, billing] = await Promise.all([
    getWorkspaceEntitlements(workspaceId),
    getWorkspaceBilling(workspaceId),
  ]);
  const credits = await callerCredits(resolved, caller, billing, entitlements);

  return {
    plan: entitlements.plan,
    status: entitlements.status,
    // From the auth context, not a fourth read: `withWorkspaceAuth` already
    // resolved the row this request was authorized against. Absent = the
    // `standard` default (a row read before `20260920120000` applied).
    containerKind: caller.workspaceKind ?? "standard",
    memberCount: entitlements.memberCount,
    seatCount: entitlements.seatCount,
    objectCap: entitlements.objectCap,
    objectsUsed: entitlements.objectsUsed,
    canCreateObjects: entitlements.canCreateObjects,
    chatsWindowDays: entitlements.chatsWindowDays,
    // The process stamp rides here, not inside `callerCredits`: every arm of that
    // function would otherwise have to remember it, the peer fence's early return
    // included (2026-09-14).
    credits: { ...credits, unmeteredSince: unmeteredSince() },
    cancelAtPeriodEnd: billing?.cancelAtPeriodEnd ?? false,
    subscription_period_end: billing?.currentPeriodEnd ?? null,
    has_stripe_customer: !!billing?.stripeCustomerId,
  };
}

/**
 * The caller's own meter, or the unmetered posture when there is none to show
 * them.
 *
 * Credits read the ENTITLED plan and the same period helpers the consume path
 * uses, so the meter cannot disagree with what enforcement charges. The member
 * count comes from the entitlements read rather than being counted twice.
 */
async function callerCredits(
  resolved: BillingTarget,
  caller: CreditCaller,
  billing: Awaited<ReturnType<typeof getWorkspaceBilling>>,
  entitlements: Awaited<ReturnType<typeof getWorkspaceEntitlements>>
): Promise<WalletCredits> {
  if (resolved.wallet === null) return reconciled(unmeteredSummary(), resolved);
  // The peer fence: a non-owner gets the same stamped zeroes the consume path
  // reports, never a reading of somebody else's allowance — and no drift figure
  // either, since the reconciliation reads the OWNER's wallet.
  if (resolved.payerUserId !== caller.userId) {
    return { ...unmeteredSummary(), ledgerDrift: 0 };
  }
  if (resolved.wallet === "personal") {
    // The meter must read the row enforcement charges against: for a personal
    // wallet that is the PAYER'S home space, which is the addressed one
    // only when the caller addressed their own shelf. In a link container the row
    // above is `null`, so metering with it would show a Pro operator 500 while
    // the consume path charged against 5,000.
    const personal =
      caller.workspaceKind === "home"
        ? billing
        : await readPersonalBilling(resolved.payerUserId, null);
    // Member count 1: a home space holds its owner and nobody else, so
    // the addressed container's roster is not this wallet's business.
    return reconciled(await summarizeCredits(resolved, personal, 1), resolved);
  }
  return reconciled(
    await summarizeCredits(resolved, billing, entitlements.memberCount),
    resolved
  );
}

/**
 * Stamp a meter with its wallet's reconciliation verdict.
 *
 * The period is the meter's own, never re-derived from the clock: counter and
 * ledger are keyed on `period_start`, and a wallet on a Stripe anchor does not
 * roll on the 1st, so a different window reports drift that is two months.
 *
 * One round-trip pair, on the settings/overview read only — not on the consume
 * path, and it must not be put there.
 */
async function reconciled(
  credits: CreditsSummary,
  resolved: BillingTarget
): Promise<WalletCredits> {
  return {
    ...credits,
    ledgerDrift: await ledgerDriftFor(resolved, credits.periodStart),
  };
}
