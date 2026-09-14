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
  // ⚠ THE SAME zeroes the consume path returns, from ONE definition. Two copies
  // of "the degraded reading" is how one surface comes to omit the `degraded`
  // stamp the other sets, and the stamp only works if every reader sees it.
  unmeteredSummary,
} from "./credits-meter";

/**
 * `GET /api/billing/status` payload, assembled here so the route stays thin
 * (§2) and the shape has ONE server-side definition.
 *
 * ⚠ MUST STAY IN SYNC with its client mirror
 * `features/billing/components/use-workspace-entitlements.ts ›
 * WorkspaceEntitlementsStatus` — edit both together.
 *
 * ⚠ `subscription_period_end` / `has_stripe_customer` keep their snake/flat
 * legacy names: already on the wire, read by shipped clients.
 *
 * ⚠ **`containerKind` LANDED 2026-09-08** with the personal Pro tier: two plan
 * taxonomies now exist (`../plans.ts › plansForKind`) and no renderer can pick
 * between them from `plan` alone — `free` is a value on both lists.
 */
/**
 * The meter, plus the RECONCILIATION verdict for the wallet it read.
 *
 * 🔒 **`ledgerDrift` IS ON THE STATUS PAYLOAD AND ON NOTHING ELSE (2026-09-13,
 * F-693).** `CreditsSummary` is shared with `CreditConsumeResult`, which is the
 * body `POST /api/mcp/credits/consume` returns to the MCP server — a wire shape
 * with shipped readers, and a diagnostic has no business on the hottest path in
 * the product. Extending here rather than there keeps that response byte-identical.
 */
export interface StatusCredits extends CreditsSummary {
  /**
   * `counter - SUM(ledger)` for this wallet and period. **0 = reconciled**, which
   * is what every row written after
   * `20261004120000_credit_consume_with_ledger.sql` must be, and what an
   * unreadable reconciliation also reports (`credits-audit.ts › ledgerDriftFor`
   * degrades with a warn — the migration ships unapplied).
   *
   * ⚠ **NEW ON THE WIRE, SO THE CLIENT MIRROR NEEDS A `?? 0`** (INVARIANTS §8):
   * the query cache is IndexedDB-persisted with a 24h gcTime, so a row stored
   * before this field shipped replays after it with the key absent.
   * `components/use-workspace-entitlements.ts` defaults it FIELD-WISE inside
   * `credits`, and a stale-cache case pins it.
   */
  ledgerDrift: number;
  /**
   * 🔒 **WHEN THIS SERVER PROCESS FIRST FAILED OPEN ON A CHARGE AND HAS NOT
   * RECOVERED SINCE — ISO-8601, or `null` when it is metering normally
   * (2026-09-14).** `POST /api/mcp/credits/consume` fails OPEN by decision, so a
   * dead RPC — the `PGRST202` a web deploy gets between shipping and its
   * migration applying — ran the whole estate UNMETERED while both meters showed
   * the same `0` they show for a measured empty month. This is the field that
   * tells those two apart.
   *
   * ⚠ **PROCESS-LOCAL, AND THAT IS A STATED LIMITATION** (`./credits-unmetered.ts`
   * carries it in full): the answer describes the process that served THIS read,
   * so on a multi-instance deployment a `null` means only "not this instance".
   * It never falsely accuses, and the deploy-ordering case it exists for affects
   * every instance at once.
   *
   * ⚠ **IT IS NOT `degraded`.** `degraded` is a decided posture the service
   * reports about the ANSWER it just computed (a peer's meter, a container with
   * no active owner); this is a fault in the CHARGE path, and the two render
   * different words on the same surfaces.
   *
   * ⚠ **NEW ON THE WIRE, SO THE CLIENT MIRROR NEEDS A `?? null`** (INVARIANTS §8):
   * the query cache is IndexedDB-persisted with a 24h gcTime, so a row stored
   * before this field shipped replays after it with the key absent.
   * `components/use-workspace-entitlements.ts` defaults it FIELD-WISE inside
   * `credits`, and a stale-cache case pins it.
   */
  unmeteredSince: string | null;
}

/** The meter as `callerCredits` builds it. ⚠ `unmeteredSince` is stamped ONCE, at
 *  the top, because it is a fact about the PROCESS and not about the wallet any
 *  of these arms read — stamping it per arm is how one arm comes to omit it. */
type WalletCredits = Omit<StatusCredits, "unmeteredSince">;

export interface WorkspaceBillingStatusPayload {
  /**
   * The ENTITLED plan of the addressed container. ⚠ On a `kind='personal'`
   * container this is `pro` or `free` and NEVER `team` (2026-09-08) — the two
   * taxonomies do not overlap, and a surface that renders plan cards must pick
   * the list by `containerKind`, not by guessing from this value.
   */
  plan: string;
  status: string;
  /**
   * WHICH KIND OF CONTAINER these entitlements describe — the field that tells
   * a renderer whether it is looking at a workspace (seats, members, Team) or
   * somebody's home space (flat, one member, Pro).
   *
   * ⚠ **NEW 2026-09-08, SO THE CLIENT MIRROR NEEDS A FALLBACK.** The query
   * cache is IndexedDB-persisted with a 24h gcTime (INVARIANTS §8): a row
   * stored before this field shipped replays after it, with the key absent.
   * `use-workspace-entitlements.ts` defaults it to `"standard"` — the same
   * default `workspaces/types.ts › isStandardWorkspace` takes for an absent
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
 * 🔒 **THE METER IS THE CALLER'S OWN WALLET, AND ONLY EVER THEIRS (2026-09-07,
 * with Samuel's per-seat + personal-wallet ruling).** A member reads their seat;
 * a container OWNER reads their personal wallet. A PEER inside somebody's link
 * container reads the unmetered posture — the owner's personal wallet spans
 * every relationship that owner has, so showing it to one peer would print the
 * operator's total home spend inside a two-person channel.
 *
 * ⚠ **THIS REPLACES THE PAYER-NARROWING FENCE, WHICH HAS NOTHING LEFT TO
 * FENCE.** Until this wave the resolver could answer with a DIFFERENT workspace
 * — the container owner's standard workspace — and this payload carries plan,
 * member count, seat count, object cap and `objectsUsed`, so handing a peer
 * that target printed the operator's private workspace inside the relationship.
 * `resolveBillingTarget` answers the ADDRESSED container **on this path**, so the
 * entitlements half reads the workspace the caller is already authorized into
 * and there is no other tenant's row on this path at all. What survives is the
 * CREDIT half of the fence, above: a peer's meter is not the owner's meter.
 *
 * ⚠ **"ALWAYS THE ADDRESSED CONTAINER" IS NO LONGER TRUE OF THAT FUNCTION —
 * IT IS TRUE OF THIS CALLER (rule B, 2026-09-13).** Under a calling channel the
 * resolver answers the CHANNEL's container; this route passes NO `channelId`,
 * deliberately, because a meter is a question about a container a person is
 * LOOKING AT rather than about a session that is spending. Adding one here would
 * print a wallet the surrounding plan/member/seat block does not describe.
 *
 * ⚠ For a container the entitlements block therefore describes the CONTAINER
 * (free plan, its own member count, no objects) rather than some workspace the
 * owner also happens to own. That is the honest answer: a container carries no
 * plan, and the credits that pay for it are on a wallet, not a tenant.
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
    // ⚠ FROM THE AUTH CONTEXT, NOT A FOURTH READ. `withWorkspaceAuth` already
    // resolved the row this request was authorized against; asking the database
    // again would be paying for an answer the caller handed us. Absent = the
    // `standard` default (a row read before `20260920120000` applied).
    containerKind: caller.workspaceKind ?? "standard",
    memberCount: entitlements.memberCount,
    seatCount: entitlements.seatCount,
    objectCap: entitlements.objectCap,
    objectsUsed: entitlements.objectsUsed,
    canCreateObjects: entitlements.canCreateObjects,
    chatsWindowDays: entitlements.chatsWindowDays,
    // ⚠ THE PROCESS STAMP RIDES ALONG HERE, NOT INSIDE `callerCredits`: every
    // arm of that function would otherwise have to remember it, including the
    // peer fence's early return (2026-09-14).
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
 * ⚠ Credits read the ENTITLED plan and the same period helpers the consume path
 * uses, so the meter cannot disagree with what enforcement charges. The
 * entitlements read already produced the member count the seat verdict needs —
 * it is passed through rather than counted twice.
 */
async function callerCredits(
  resolved: BillingTarget,
  caller: CreditCaller,
  billing: Awaited<ReturnType<typeof getWorkspaceBilling>>,
  entitlements: Awaited<ReturnType<typeof getWorkspaceEntitlements>>
): Promise<WalletCredits> {
  if (resolved.wallet === null) return reconciled(unmeteredSummary(), resolved);
  // 🔒 THE PEER FENCE. A personal wallet belongs to the container's owner; a
  // non-owner asking about it gets the same stamped zeroes the consume path
  // reports, never a reading of somebody else's allowance.
  // ⚠ **AND NO DRIFT FIGURE EITHER**: the reconciliation reads the OWNER's wallet,
  // so answering a peer with it would leak the shape of somebody else's spend
  // through the one field that survives the fence.
  if (resolved.payerUserId !== caller.userId) {
    return { ...unmeteredSummary(), ledgerDrift: 0 };
  }
  if (resolved.wallet === "personal") {
    // ⚠ **THE METER MUST READ THE SAME ROW ENFORCEMENT CHARGES AGAINST**, and
    // for a personal wallet that is the PAYER'S PERSONAL CONTAINER — which is
    // the addressed container only when the caller addressed their own home
    // shelf. In a link container the row above is `null` (containers carry no
    // billing), so metering with it would show a Pro operator 500 while the
    // consume path charged them against 5,000. Same helper, same answer, one
    // extra read only on the arm that needs it.
    const personal =
      caller.workspaceKind === "personal"
        ? billing
        : await readPersonalBilling(resolved.payerUserId, null);
    // ⚠ MEMBER COUNT 1: a personal container holds its owner and nobody else,
    // so the addressed container's roster is not the payer's wallet's business.
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
 * ⚠ **THE PERIOD IS THE METER'S OWN, NEVER RE-DERIVED FROM THE CLOCK.** The
 * counter and the ledger are both keyed on `period_start`, and a wallet on a Stripe
 * anchor does not roll on the 1st — reconciling a different window than the meter
 * read would report drift that is really two different months.
 *
 * ⚠ ONE round trip pair, on the SETTINGS/overview read only. It is not on the
 * consume path and must not be put there.
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
