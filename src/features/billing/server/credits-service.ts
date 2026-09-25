import "server-only";
import { findActiveOwnerUserId } from "@/features/workspaces/server/repository";
import {
  isStandardWorkspace,
  type WorkspaceKind,
} from "@/features/workspaces/types";
import {
  CREDITS_PER_MCP_CALL,
  PERSONAL_MONTHLY_CREDITS,
  SEAT_MONTHLY_CREDITS,
  seatCreditsForPlan,
  type CreditPeriod,
  type WalletKind,
} from "../credits";
import type { PlanId } from "../plans";
import { consumeMemberCredits, consumeUserCredits } from "./credit-wallets";
import { resolveCallingChannel } from "./channel-attribution";
import type { CreditLedgerAttribution } from "./credit-ledger";
import { creditPeriodFor, unmetered } from "./credits-meter";
import { entitledPlanFor, upgradeUrl } from "./entitlements";
import {
  personalWalletTier,
  readPersonalBilling,
  type PersonalWalletTier,
} from "./personal-wallet";
import { countActiveMembers, getWorkspaceBilling } from "./workspace-billing";

/**
 * MCP credits — business logic between route and repository. Numbers live in
 * `../credits.ts` (the one retune spot); this owns only "may this call proceed"
 * and "how much is left".
 *
 * Rulings:
 * - 2026-09-07: two wallets, and the charged container's kind picks one. A
 *   standard workspace charges the caller's own seat; a home-space container
 *   charges the container owner's personal wallet.
 * - Rule B (2026-09-13): the CALLING CHANNEL's container is charged, falling back
 *   to the addressed resource's container when there is no calling channel. The
 *   channel comes from `./channel-attribution.ts`, which also fences the
 *   forgeable header it is read from.
 * - F-693 (2026-09-13): the attribution row is part of the spend, written by the
 *   wallet RPC in the counter's transaction — this file has no ledger write at
 *   all. Dimensions travel as `credit-ledger.ts › CreditLedgerAttribution`.
 * - 2026-09-08: the personal wallet has a plan (Pro), billed on the owner's own
 *   `kind='home'` container, so both personal arms resolve a billing row via
 *   `./personal-wallet.ts` — one round trip more than before.
 *
 * The plan is always the entitlement verdict, never `workspace_billing.plan`: a
 * solo sub that grew a second member is degraded to free by
 * `entitlements.ts › paidEntitlement`, and the raw column would hand every one of
 * its members the paid allowance.
 */

/** Who is burning the credit. The seat wallet is keyed on the caller and the
 *  personal wallet on the container's owner, so there is no wallet to move
 *  without knowing who called. */
export interface CreditCaller {
  userId: string;
  /** The addressed workspace's kind. Absent = standard (column not yet applied). */
  workspaceKind?: WorkspaceKind;
  /**
   * Rule B's input: the channel whose container is charged, from the
   * `<channelId>:<tail>` head of `X-Dopl-Session-Id`
   * (`./channel-attribution.ts` fences it). Absent or `null` is ordinary and never
   * a refusal — external MCP clients, app clicks and older desktop builds all look
   * like this and charge the resource's container.
   */
  channelId?: string | null;
}

/**
 * Why a burn found no counter to move. Never silent — `consumeMcpCredits` logs it.
 * One reason since 2026-09-07: a home burn lands on the owner's personal wallet,
 * and every user has exactly one of those, so nothing can be missing or ambiguous.
 */
export type UnmeteredReason = "container-has-no-active-owner";

/**
 * Which counter a burn moves, and whose allowance that is.
 *
 * `workspaceId` is the CHARGED container (the calling channel's under rule B,
 * else the addressed one), never "the workspace that pays" — the payer is always
 * `payerUserId`. The ledger records the ADDRESSED container as the row's origin;
 * the two differ exactly when an agent reaches across containers.
 */
export type BillingTarget =
  | {
      wallet: "seat";
      workspaceId: string;
      payerUserId: string;
      channelId: string | null;
    }
  | {
      wallet: "personal";
      workspaceId: string;
      payerUserId: string;
      channelId: string | null;
      /**
       * The container to read the personal billing row from, or `null` to reach it
       * through the payer. Non-null only for a `kind='home'` container, which
       * is its own billing row — `personal-wallet.ts › readPersonalBilling` refuses
       * any other id, since a link container has no row and passing its id would
       * report every Pro operator as free.
       */
      personalBillingContainerId: string | null;
    }
  | {
      wallet: null;
      workspaceId: string;
      payerUserId: null;
      channelId: string | null;
      reason: UnmeteredReason;
    };

/**
 * Which container pays, which wallet that is, and whose.
 *
 * Rule B (2026-09-13): the calling channel's container pays; with no calling
 * channel, the resource's does. Channel resolution and its fence live in
 * `./channel-attribution.ts`; the kind→wallet half is {@link containerTarget}.
 *
 * 2026-08-26: a home-space burn is charged to the container's owner whoever made
 * the call. A `link` container is a relationship and a `home` container is a
 * shelf; neither is a tenant and neither carries a plan.
 */
export async function resolveBillingTarget(
  workspaceId: string,
  caller: CreditCaller
): Promise<BillingTarget> {
  const channel = await resolveCallingChannel(caller, workspaceId);
  return channel
    ? containerTarget(
        channel.workspaceId,
        channel.kind,
        caller.userId,
        channel.channelId
      )
    : containerTarget(workspaceId, caller.workspaceKind, caller.userId, null);
}

/**
 * The whole kind→wallet decision for one container, reached from both of rule B's
 * arms so neither can drift.
 *
 * `kind='home'` skips the owner lookup — a round trip saved, not a check
 * skipped: such a container has exactly one member, its owner, so the caller is
 * provably the payer.
 *
 * `kind` is wide (`string`) because the cross-container arm reads it off a row
 * rather than off the auth context: a value the enum does not carry must land on
 * `isStandardWorkspace`'s negative side and be treated as a home-space container,
 * never crash and never be read as a workspace.
 */
async function containerTarget(
  workspaceId: string,
  kind: WorkspaceKind | string | undefined,
  userId: string,
  channelId: string | null
): Promise<BillingTarget> {
  if (isStandardWorkspace({ kind: kind as WorkspaceKind | undefined })) {
    return { wallet: "seat", workspaceId, payerUserId: userId, channelId };
  }
  if (kind === "home") {
    return {
      wallet: "personal",
      workspaceId,
      payerUserId: userId,
      channelId,
      personalBillingContainerId: workspaceId,
    };
  }
  const ownerUserId = await findActiveOwnerUserId(workspaceId);
  if (!ownerUserId) {
    return {
      wallet: null,
      workspaceId,
      payerUserId: null,
      channelId,
      reason: "container-has-no-active-owner",
    };
  }
  return {
    wallet: "personal",
    workspaceId,
    payerUserId: ownerUserId,
    channelId,
    personalBillingContainerId: null,
  };
}

/** What a wallet's credit meter says right now. */
export interface CreditsSummary extends CreditPeriod {
  /** Which counter these numbers came off. `null` = none was read; see
   *  `unmetered()`. */
  wallet: WalletKind | null;
  used: number;
  limit: number;
  remaining: number;
  /** Present only when the zeroes were not measured — see `unmetered()` — so a
   *  renderer can tell "nothing spent" from "nothing counted". */
  degraded?: true;
}

/** The consume decision, plus everything a refusal needs to explain itself. */
export interface CreditConsumeResult extends CreditsSummary {
  allowed: boolean;
  /** Where an exhausted caller is sent, or `""` when there is nothing to buy.
   *  In the RESPONSE because the MCP server package cannot import the
   *  server-side `upgradeUrl()`. */
  upgradeUrl: string;
  /**
   * F-668 (2026-09-14): what the offer at `upgradeUrl` buys, `0` when there is no
   * offer. `packages/mcp-server/src/tools/respond.ts › creditsExhausted` cannot
   * import `../credits.ts` (separate build, external by `next.config.ts ›
   * serverExternalPackages`), so the figure was a literal in two places and a
   * retune left the refusal advertising the old number. The number crosses the
   * wire, the wording does not. Not `limit` — that is the allowance just
   * exhausted; this is what an upgrade would give.
   */
  upgradeCredits: number;
}

/**
 * Where an exhausted wallet is sent, or `""` when there is nothing to buy.
 *
 * 2026-09-08: a free verdict on either wallet has an offer, and they are different
 * offers. A free home space is sold Pro via `?plan=pro`, not the bare link,
 * because segment-less `/billing` resolves a standard workspace by default.
 *
 * Any paid verdict offers nothing — Team and Pro are each the best allowance their
 * wallet has, and the MCP refusal renders this url literally
 * (`tools/respond.ts › creditsExhausted`), so an upsell to nowhere is worse than none.
 */
function upgradeUrlFor(wallet: WalletKind | null, plan: PlanId | null): string {
  if (plan !== "free") return "";
  if (wallet === "seat") return upgradeUrl();
  return wallet === "personal" ? upgradeUrl("pro") : "";
}

/**
 * What the offer at `upgradeUrlFor`'s url buys, or `0` when there is none.
 *
 * F-668 (2026-09-14): the one place the paid figure is read for the MCP refusal,
 * off `../credits.ts`, so retuning an allowance stays a one-site edit. The arms
 * must track `upgradeUrlFor` exactly — same `(wallet, plan)` pair, same order —
 * or a figure ships with no link to buy it, or a link with no figure.
 */
function upgradeCreditsFor(
  wallet: WalletKind | null,
  plan: PlanId | null
): number {
  if (plan !== "free") return 0;
  if (wallet === "seat") return SEAT_MONTHLY_CREDITS.team;
  return wallet === "personal" ? PERSONAL_MONTHLY_CREDITS.pro : 0;
}

/**
 * Charge one MCP tool call to the wallet the addressed container names, then
 * spend `CREDITS_PER_MCP_CALL` through that wallet's atomic upsert-CAS RPC.
 * `allowed: false` = out of credits this period; data intact, next period rolls
 * the counter.
 *
 * Throws on an unexpected read/RPC failure — fail direction is the route's
 * decision (`POST /api/mcp/credits/consume`).
 *
 * Round-trip budget per wallet, pinned by mock call counts in
 * `credits-service.test.ts` (re-pinned 2026-09-08 when the personal arms each
 * gained a billing-row read):
 *   * seat — billing row + member count (concurrent), then the RPC: 3.
 *   * `home` — the container's own billing row, then the RPC: 2.
 *   * `link` — owner lookup, the owner's personal billing row (one embedded query,
 *     `workspace-billing.ts › getPersonalBilling`), then the RPC: 3.
 * Rule B's reads sit on `./channel-attribution.ts`'s budget, not this one.
 *
 * Do not reintroduce `getWorkspaceEntitlements` on any arm: it fans out to a
 * `COUNT(*)` over `ontology_objects` for a cap this path never consults, plus a
 * second `workspace_billing` read, once per MCP tool call.
 */
export async function consumeMcpCredits(
  workspaceId: string,
  caller: CreditCaller
): Promise<CreditConsumeResult> {
  const target = await resolveBillingTarget(workspaceId, caller);
  if (target.wallet === null) {
    // Fail open, but never silently: unmetered usage with no trace is
    // indistinguishable from the 403-and-swallow this path replaced (F-325).
    console.warn(
      `[credits] unmetered MCP burn in workspace ${workspaceId} by user ${caller.userId}: ${target.reason}`
    );
    return unmetered();
  }

  // F-693 (2026-09-13): the ledger row travels with the spend, not after it.
  // `originWorkspaceId` is the ADDRESSED container (this function's argument), not
  // `target.workspaceId` — under rule B the charged container is the calling
  // channel's, and the ledger records where the call was addressed.
  const attribution: CreditLedgerAttribution = {
    originWorkspaceId: workspaceId,
    callerUserId: caller.userId,
    // The calling channel, or null for "no channel" — not derivable from the
    // workspace columns, which is why the column exists.
    channelId: target.channelId,
  };

  const spend =
    target.wallet === "personal"
      ? await spendPersonal(
          target.payerUserId,
          // The charged container is the billing row only when it is
          // `kind='home'`; a link container has none, so passing its id would
          // read nothing and bill a Pro operator at the free tier. Read off the
          // target, not `caller.workspaceKind`: under rule B the charged container
          // is the channel's, and the addressed container's kind says nothing.
          target.personalBillingContainerId,
          attribution
        )
      : await spendSeat(target.workspaceId, target.payerUserId, attribution);

  // F-693: nothing is written here, and the absence is the fix — the attribution
  // row is inserted by the wallet RPC in the counter's own transaction. Do not
  // re-add a post-spend write of any kind, awaited or not: two round trips cannot
  // be made atomic from here.

  return {
    ...spend.period,
    wallet: target.wallet,
    allowed: spend.outcome.allowed,
    used: spend.outcome.used,
    limit: spend.limit,
    remaining: Math.max(0, spend.limit - spend.outcome.used),
    upgradeUrl: upgradeUrlFor(target.wallet, spend.plan),
    upgradeCredits: upgradeCreditsFor(target.wallet, spend.plan),
  };
}

/** One wallet's spend, with everything the answer is rendered from. */
interface WalletSpend {
  period: CreditPeriod;
  limit: number;
  /** The entitled plan — non-null on both wallets since 2026-09-08, since
   *  `upgradeUrlFor` reads a `null` as "nothing to sell". */
  plan: PlanId;
  outcome: { allowed: boolean; used: number };
}

/**
 * Personal wallet: the payer's own billing row decides the tier, the tier decides
 * both the window and the limit, then the RPC. Two round trips.
 *
 * `personalBillingContainerId` is the charged container's id when that container is
 * `kind='home'` (it is the billing row, so the owner → container hop is
 * skipped) and `null` for a link container, which carries no billing row.
 */
async function spendPersonal(
  payerUserId: string,
  personalBillingContainerId: string | null,
  attribution: CreditLedgerAttribution
): Promise<WalletSpend> {
  const billing = await readPersonalBilling(
    payerUserId,
    personalBillingContainerId
  );
  const tier: PersonalWalletTier = personalWalletTier(billing);
  const outcome = await consumeUserCredits(
    payerUserId,
    tier.periodStart,
    CREDITS_PER_MCP_CALL,
    tier.limit,
    attribution
  );
  return {
    period: { periodStart: tier.periodStart, periodEnd: tier.periodEnd },
    limit: tier.limit,
    plan: tier.verdict,
    outcome,
  };
}

/** Seat wallet: the billing row and member count decide the verdict, the verdict
 *  decides both the window and the per-member limit. */
async function spendSeat(
  workspaceId: string,
  payerUserId: string,
  attribution: CreditLedgerAttribution
): Promise<WalletSpend> {
  const [billing, memberCount] = await Promise.all([
    getWorkspaceBilling(workspaceId),
    countActiveMembers(workspaceId),
  ]);
  const plan = entitledPlanFor(billing, memberCount);
  const period = creditPeriodFor(billing, plan);
  const limit = seatCreditsForPlan(plan);
  const outcome = await consumeMemberCredits(
    workspaceId,
    payerUserId,
    period.periodStart,
    CREDITS_PER_MCP_CALL,
    limit,
    attribution
  );
  return { period, limit, plan, outcome };
}
