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
 * MCP credits — business logic between route and repository. NUMBERS live in
 * `../credits.ts` (the one retune spot); this owns only the two questions that
 * need the database: "may this call proceed" and "how much is left".
 *
 * 🔒 **TWO WALLETS, AND A CONTAINER'S KIND PICKS ONE (Samuel, 2026-09-07).** A
 * standard workspace charges the CALLER'S OWN SEAT at the workspace's entitled
 * per-member allowance; a home-space container charges the container OWNER'S
 * PERSONAL wallet. Every path implements the same table:
 *
 *   | charged kind   | wallet     | payer                | limit                       | period                |
 *   |----------------|------------|----------------------|-----------------------------|-----------------------|
 *   | `standard`     | `seat`     | the caller           | `seatCreditsForPlan(…)`     | `resolveCreditPeriod` |
 *   | `personal`     | `personal` | the caller (= owner) | `personalCreditsForPlan(…)` | `resolveCreditPeriod` |
 *   | `link`         | `personal` | the container OWNER  | `personalCreditsForPlan(…)` | `resolveCreditPeriod` |
 *   | no active owner| —          | —                    | unmetered, logged           | —                     |
 *
 * 🔒 **AND *WHICH* CONTAINER IS RULE B SINCE 2026-09-13 (Samuel: "the wallet
 * needs to match the histogram — that's the whole point").** The table above used
 * to be keyed on the ADDRESSED container; it is keyed on the CALLING CHANNEL's
 * container now, and falls back to the addressed resource's container only when
 * there is no calling channel. So a home-channel agent spends the channel
 * owner's personal wallet WHATEVER IT TOUCHES, and a workspace-channel agent
 * spends the caller's seat in that workspace whatever it touches. The channel
 * comes from `./channel-attribution.ts`, which also carries the fence that makes
 * a forgeable header safe to bill from.
 *
 * 🔒 **AND THE ATTRIBUTION ROW IS PART OF THE SPEND SINCE 2026-09-13, NOT A
 * FOLLOW-UP (Samuel: "the histogram must equal the wallet, always"; F-693).**
 * `credit_usage_events` is written by the wallet RPC itself, in the counter's
 * transaction — so this file no longer has a ledger write at all, and there is no
 * arm on which a counter can move without one. The dimensions travel as
 * `credit-ledger.ts › CreditLedgerAttribution`.
 *
 * ⚠ The plan is the ENTITLEMENT VERDICT, never `workspace_billing.plan` — a
 * solo sub that grew a second member is degraded to free by
 * `entitlements.ts › paidEntitlement`, and the raw column would hand every one
 * of its members the paid allowance.
 *
 * 🔒 **AND THE PERSONAL WALLET HAS A PLAN SINCE 2026-09-08** (Samuel's $8.99
 * ruling; spec §11.1). ⚠ **THE SUPERSEDED ROWS SAID `PERSONAL_MONTHLY_CREDITS`
 * AND `personalCreditPeriod` — ONE CONSTANT AND THE CALENDAR MONTH, NO ROW
 * READ AT ALL.** The personal Pro tier is billed on the owner's own
 * `kind='personal'` container, so both personal rows now resolve a billing row
 * exactly as the seat row does, through `./personal-wallet.ts`. That costs the
 * personal arm one round trip it did not pay before, and the budget below is
 * re-pinned to say so rather than to hide it.
 */

/** Who is burning the credit. ⚠ REQUIRED since 2026-09-07: the seat wallet is
 *  keyed on the caller and the personal wallet on the container's owner, so
 *  there is no wallet to move without knowing who called. */
export interface CreditCaller {
  userId: string;
  /** The ADDRESSED workspace's kind. Absent = standard (column not yet applied). */
  workspaceKind?: WorkspaceKind;
  /**
   * 🔒 **THE CALLING CHANNEL — RULE B's INPUT (2026-09-13).** The channel whose
   * container is charged, from `X-Dopl-Session-Id`'s `<channelId>:<tail>` head,
   * which the desktop stamps on every session it spawns
   * (`app/api/mcp/credits/consume/route.ts` reads it; `./channel-attribution.ts`
   * fences it). ⚠ **ABSENT OR `null` IS ORDINARY AND IS NEVER A REFUSAL** — a
   * Claude Desktop or Claude Code MCP connection, an app click and an older
   * desktop build all look like this, and they charge the RESOURCE's container as
   * they always have. A SUB-AGENT sends its OWN session's key, which is why it is
   * filed under its own channel with no extra rule.
   */
  channelId?: string | null;
}

/**
 * Why a burn found no counter to move. Never silent — `consumeMcpCredits` logs
 * it.
 *
 * ⚠ **ONE REASON LEFT SINCE 2026-09-07.** `container-owner-has-no-billing-workspace`
 * and `container-owner-has-ambiguous-billing-workspace` are DELETED with the
 * lookup that produced them: a home burn no longer needs the owner to have a
 * standard workspace at all, because it lands on the owner's PERSONAL wallet
 * and every user has exactly one of those (`20260920120000_workspace_kind_personal.sql`).
 * There is nothing left to be missing or ambiguous.
 */
export type UnmeteredReason = "container-has-no-active-owner";

/**
 * Which counter a burn moves, and whose allowance that is.
 *
 * ⚠ **`workspaceId` IS THE CHARGED CONTAINER, WHICH IS THE CALLING CHANNEL'S
 * SINCE 2026-09-13 AND THE ADDRESSED ONE ONLY WITHOUT A CHANNEL (rule B).** It
 * has never been "the workspace that pays" — on the seat arm it is half the
 * counter key, on the personal arm it only names where the wallet lives. The
 * PAYER is always `payerUserId`. ⚠ The LEDGER still records the ADDRESSED
 * container as the row's origin; the two differ exactly when an agent reaches
 * across containers, which is what `channelId` exists to make readable.
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
       * The container to read the PERSONAL billing row from, or `null` to reach
       * it through the payer. Non-null ONLY for a `kind='personal'` container,
       * which IS its own billing row (`personal-wallet.ts › readPersonalBilling`
       * refuses any other id for a reason: a link container has no row, so
       * passing its id reports every Pro operator as free).
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
 * WHICH CONTAINER PAYS, WHICH WALLET THAT IS, AND WHOSE.
 *
 * 🔒 **RULE B (Samuel, 2026-09-13): THE CALLING CHANNEL'S CONTAINER PAYS; WITH NO
 * CALLING CHANNEL, THE RESOURCE'S DOES.** The channel resolution and the fence
 * that makes a forgeable header safe to bill from are
 * `./channel-attribution.ts`; the kind→wallet half is {@link containerTarget}.
 * ⚠ The superseded rule charged the ADDRESSED container, so an agent reaching
 * across containers billed whichever wallet its tool argument happened to name —
 * which is why a wallet's by-channel breakdown could not sum to the wallet.
 *
 * 🔒 **A HOME-SPACE BURN IS CHARGED TO THE CONTAINER'S OWNER, WHOEVER MADE THE
 * CALL** (Samuel, 2026-08-26: "charge MCP calls from a guest to the user"), and
 * rule B widens that rather than touching it: owner-pays for members and guests
 * in your home channels, wherever their tool calls land. A `link` container is a
 * relationship and a `personal` container is a shelf; neither is a tenant and
 * neither carries a plan.
 *
 * ⚠ The 2026-09-07 reroute onto the owner's sole owned STANDARD workspace
 * (`findSoleOwnedStandardWorkspace`, with its two refusal reasons) left this path
 * with the personal wallet and is not coming back — INVARIANTS §4's BILLING-ONLY
 * bullet has what it still answers.
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
 * The table in this file's header, for ONE container — the whole of the
 * kind→wallet decision, reached from both of rule B's arms so neither can drift.
 *
 * ⚠ **`kind='personal'` SKIPS THE OWNER LOOKUP, AND THAT IS A ROUND TRIP SAVED,
 * NOT A CHECK SKIPPED.** A personal container has exactly one member, its owner
 * (`20260920120000` §3), and only that owner can be authorized into it — so the
 * caller IS the payer, provably. ⚠ Under rule B the caller is the payer on that
 * arm only because a `kind='personal'` container holds no channel: the arm is
 * reached with the ADDRESSED container, never with a channel's.
 *
 * ⚠ `kind` IS WIDE (`string`) because the cross-container arm reads it off a row
 * rather than off the auth context: a value the enum does not carry must land on
 * `isStandardWorkspace`'s NEGATIVE side and be treated as a home-space container,
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
  if (kind === "personal") {
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
  /** Present only when the zeroes were NOT measured — see `unmetered()`. Absent
   *  on every real reading, so a renderer can tell "nothing spent" from
   *  "nothing counted". */
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
   * 🔒 **WHAT THE OFFER AT `upgradeUrl` BUYS, `0` WHEN THERE IS NO OFFER — HERE
   * FOR THE SAME REASON `upgradeUrl` IS (2026-09-14, F-668 CLOSED).**
   * `packages/mcp-server/src/tools/respond.ts › creditsExhausted` writes
   * *"Upgrade to Team for 5,000 credits per member"* and cannot import
   * `../credits.ts` (a separate build, external by `next.config.ts ›
   * serverExternalPackages`), so the figure was a LITERAL in two places: a
   * retune of `SEAT_MONTHLY_CREDITS.team` left the refusal advertising the old
   * number to the caller who just hit the limit, and **no test could see it** —
   * the package's pin asserted the literal against itself.
   * ⚠ **THE NUMBER CROSSES THE WIRE, THE WORDING DOES NOT**: the MCP layer
   * still owns the sentence and this carries the one fact it cannot know.
   * ⚠ **IT IS NOT `limit`** — that is the allowance the caller just exhausted
   * (100 on a free seat); this is what an upgrade would give them.
   */
  upgradeCredits: number;
}

/**
 * Where an exhausted wallet is sent, or `""` when there is nothing to buy.
 *
 * ⚠ **A FREE VERDICT ON EITHER WALLET HAS AN OFFER SINCE 2026-09-08, AND THEY
 * ARE DIFFERENT OFFERS.** The superseded rule was "a seat on a free workspace
 * is the ONLY thing with something to buy", true only while the personal wallet
 * had no paid tier. A free HOME space is now sold Pro — and it must be sold
 * `?plan=pro`, not the bare upgrade link, because segment-less `/billing`
 * resolves a STANDARD workspace by default and would land a home-space upsell
 * on a workspace the caller may not even have.
 *
 * ⚠ **ANY PAID VERDICT OFFERS NOTHING**, on both wallets: Team and Pro are each
 * the best allowance their wallet has. The MCP refusal renders this url
 * literally when it is non-empty (`tools/respond.ts › creditsExhausted`), so an
 * upsell to nowhere is worse than no link at all.
 */
function upgradeUrlFor(wallet: WalletKind | null, plan: PlanId | null): string {
  if (plan !== "free") return "";
  if (wallet === "seat") return upgradeUrl();
  return wallet === "personal" ? upgradeUrl("pro") : "";
}

/**
 * What the offer at `upgradeUrlFor`'s url BUYS, or `0` when there is none.
 *
 * 🔒 **THE ONE PLACE THE PAID FIGURE IS READ FOR THE MCP REFUSAL (F-668 CLOSED,
 * 2026-09-14).** It reads `../credits.ts` — THE one retune spot — so retuning a
 * paid allowance is a ONE-SITE edit again.
 * ⚠ **THE ARMS TRACK `upgradeUrlFor` EXACTLY, AND MUST**: a figure beside no
 * link is a promise with nowhere to buy it, and a link with no figure drops the
 * fact that makes it persuasive. Same `(wallet, plan)` pair, same order.
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
 * THROWS on an unexpected read/RPC failure — fail DIRECTION is the route's
 * decision (`POST /api/mcp/credits/consume`).
 *
 * ⚠ **THE ROUND-TRIP BUDGET IS PER WALLET, AND EVERY NUMBER IS PINNED BY MOCK
 * CALL COUNTS** in `credits-service.test.ts`:
 * ⚠ **RULE B ADDS ITS OWN READS ON TOP, AND THEY ARE ON `./channel-attribution.ts`'s
 * BUDGET, NOT THIS ONE: 0 with no calling channel, +1 for a channel in the
 * addressed container, +2 when the call reaches across containers.** A
 * channel-less caller — every external client and every app click — pays exactly
 * what it paid before rule B.
 *
 *   * SEAT — billing row + member count (concurrent), then the RPC: **3**.
 *   * `personal` — the container's own billing row, then the RPC: **2**. The
 *     owner IS the caller, so no owner lookup, and the container IS the billing
 *     row, so no owner → container hop.
 *   * `link` — the owner lookup, the owner's personal billing row (ONE embedded
 *     query, `workspace-billing.ts › getPersonalBilling`), then the RPC: **3**.
 * Do NOT reintroduce `getWorkspaceEntitlements` on any of them: it fans out to a
 * `COUNT(*)` over `ontology_objects` for a cap this path never consults, plus a
 * second `workspace_billing` read. This runs once per MCP tool call.
 *
 * ⚠ **RE-PINNED 2026-09-08, AND THE PERSONAL ARMS EACH COST ONE MORE THAN THEY
 * DID.** The superseded budget was `link` 2 / `personal` 1, with the note "THE
 * PERSONAL ARM READS NO BILLING ROW AT ALL — one tier, one constant, no
 * anchor". That was correct and is now false: the personal wallet has a Pro
 * tier billed on the owner's own container, so its limit and its window both
 * come off a row. The read is not optional and the numbers moved rather than
 * the rule bending — a "check the plan" that skipped the read would charge a
 * paying customer 500.
 */
export async function consumeMcpCredits(
  workspaceId: string,
  caller: CreditCaller
): Promise<CreditConsumeResult> {
  const target = await resolveBillingTarget(workspaceId, caller);
  if (target.wallet === null) {
    // ⚠ FAIL OPEN, BUT NEVER SILENTLY. Unmetered usage is a decision (see
    // `unmetered()`), and a decision with no trace is indistinguishable from the
    // 403-and-swallow this path replaced (F-325). One line names the container,
    // the caller and WHY nothing was charged.
    console.warn(
      `[credits] unmetered MCP burn in workspace ${workspaceId} by user ${caller.userId}: ${target.reason}`
    );
    return unmetered();
  }

  // 🔒 **THE LEDGER ROW TRAVELS WITH THE SPEND, NOT AFTER IT (2026-09-13, F-693).**
  // ⚠ `originWorkspaceId` IS THE ADDRESSED CONTAINER, which is the argument to
  // this function and NOT `target.workspaceId` — under rule B the charged
  // container is the calling channel's, and the ledger records where the call was
  // addressed. Both columns take it, as the deleted TypeScript writer did.
  const attribution: CreditLedgerAttribution = {
    originWorkspaceId: workspaceId,
    callerUserId: caller.userId,
    // 🔒 RULE B's ATTRIBUTION: the CALLING CHANNEL, or null for "no channel"
    // (Desktop agent). ⚠ It is NOT derivable from the workspace columns — that is
    // the whole reason the column exists.
    channelId: target.channelId,
  };

  const spend =
    target.wallet === "personal"
      ? await spendPersonal(
          target.payerUserId,
          // ⚠ THE CHARGED CONTAINER IS THE BILLING ROW **ONLY** WHEN IT IS
          // `kind='personal'`. A link container has none, so passing its id
          // would read nothing and bill a Pro operator at the free tier.
          // ⚠ IT IS THE TARGET'S FIELD, NOT `caller.workspaceKind`, SINCE RULE B:
          // under a calling channel the charged container is the CHANNEL's, and
          // the addressed container's kind says nothing about it.
          target.personalBillingContainerId,
          attribution
        )
      : await spendSeat(target.workspaceId, target.payerUserId, attribution);

  // ⚠ **NOTHING IS WRITTEN HERE ANY MORE, AND THE ABSENCE IS THE FIX.** The
  // attribution row is inserted by the wallet RPC, in the counter's own
  // transaction: a refused consume inserts nothing, and a failed insert rolls the
  // counter back. The superseded code fired `recordCreditUsageEvent` here,
  // unawaited, AFTER the counter had committed — so a `42703` left the counter at
  // 8 over five ledger rows and only a `console.warn` to say so (F-693).
  // ⚠ **DO NOT RE-ADD A POST-SPEND WRITE OF ANY KIND**, awaited or not: two
  // round trips cannot be made atomic from here, and a compensating rollback can
  // itself fail on the hottest path in the product.

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
  /** The entitled plan. ⚠ NON-NULL ON BOTH WALLETS SINCE 2026-09-08 — it was
   *  `null` on the personal arm while that wallet had no tier to be on, and
   *  `upgradeUrlFor` read the `null` as "nothing to sell". Now the VERDICT
   *  decides, on both wallets, exactly as it decides the allowance. */
  plan: PlanId;
  outcome: { allowed: boolean; used: number };
}

/**
 * Personal wallet: the payer's own billing row decides the tier, the tier
 * decides both the window and the limit, then the RPC. TWO round trips.
 *
 * `personalBillingContainerId` is the CHARGED container's id when that container
 * is `kind='personal'` (it IS the billing row, so the owner → container hop is
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

/** Seat wallet: the billing row and member count decide the verdict, the
 *  verdict decides both the window and the PER-MEMBER limit. */
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
