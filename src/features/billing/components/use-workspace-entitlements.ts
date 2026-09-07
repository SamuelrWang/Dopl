"use client";

import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useApiQuery } from "@/shared/hooks/use-api-query";
import type { PlanId, BillingStatus } from "../plans";
import { PERSONAL_MONTHLY_CREDITS, type WalletKind } from "../credits";

/**
 * Client mirror of `/api/billing/status` (see `server/entitlements.ts`) — THE
 * single billing read for every surface. Omitting `workspaceId` lets the
 * endpoint resolve the caller's own container.
 *
 * Team = $8 per seat per month, and each member gets their own fixed credit
 * allocation (Samuel, 2026-09-07). ⚠ Pro/Solo — flat $5.99, one member — is
 * RETIRED FROM SALE; `SOLO_PRICE` and `isSolo` survive to LABEL the rows that
 * are still on it, and nothing here offers it.
 */

/** Aliases of the canonical taxonomy (plans.ts) — public names here so
 *  importers don't couple to plans.ts directly. */
export type WorkspacePlan = PlanId;
export type { BillingStatus };

/**
 * MCP credit meter for the CURRENT billing period; allowances in
 * `../credits.ts`. `periodStart`/`periodEnd` are ISO instants — subscription
 * anchor when paid, UTC calendar month otherwise.
 */
export interface WorkspaceCreditsStatus {
  /** WHICH WALLET these numbers came off: `seat` inside a standard workspace,
   *  `personal` in the caller's home space. ⚠ `null` on a DEGRADED reading and
   *  on a cached row stored before the field shipped — the fallback below is
   *  not optional (INVARIANTS §8). */
  wallet: WalletKind | null;
  used: number;
  limit: number;
  remaining: number;
  periodStart: string;
  periodEnd: string;
  /** Present only when the zeroes were NOT measured — the reading a NON-OWNER
   *  peer inside somebody's link container gets, a container with no active
   *  owner, and the route's own fail-open (`server/credits-service.ts ›
   *  unmetered`, `server/status-service.ts`). */
  degraded?: true;
}

export interface WorkspaceEntitlementsStatus {
  plan: WorkspacePlan;
  status: BillingStatus;
  memberCount: number;
  /** Live Stripe seat quantity; null when not on a paid plan. */
  seatCount: number | null;
  /** null = uncapped. */
  objectCap: number | null;
  objectsUsed: number;
  canCreateObjects: boolean;
  /** null = full history. */
  chatsWindowDays: number | null;
  credits: WorkspaceCreditsStatus;
  /** Live now, will not renew (Stripe's `cancel_at_period_end`). */
  cancelAtPeriodEnd: boolean;
  subscription_period_end: string | null;
  has_stripe_customer: boolean;
}

/** Pro — flat monthly price, single-member workspaces only. ⚠ LEGACY ROWS ONLY
 *  since 2026-09-07: nothing sells this plan, and the constant exists to label
 *  a workspace that is already on it. */
export const SOLO_PRICE = 5.99;
/**
 * Team — per seat per month, seats sync with membership.
 *
 * ⚠ **$8.00 SINCE 2026-09-07 (Samuel's ruling), AND STRIPE DOES NOT AGREE
 * YET.** The live price under `STRIPE_PRO_SEAT_PRICE_ID` is still 7.99; Samuel
 * creates the $8 price and flips the env, and no client code touches a Stripe
 * price. Deploy state is a measurement — read the env, not this line.
 */
export const TEAM_SEAT_PRICE = 8;

const DEFAULT_STATUS: WorkspaceEntitlementsStatus = {
  plan: "free",
  status: "free",
  memberCount: 1,
  seatCount: null,
  objectCap: null,
  objectsUsed: 0,
  canCreateObjects: true,
  chatsWindowDays: 90,
  // The free allowance, nothing spent — the degrade-to-Free direction this
  // whole default takes. The period bounds are BLANK on purpose: this fallback
  // measured nothing, and no surface renders credit dates today, so an
  // invented window would be a number with no measurement behind it.
  credits: {
    // ⚠ THE PERSONAL ALLOWANCE, NOT A PLAN'S. This default is what renders
    // before the first response lands, and the surface it renders on is most
    // often the caller's own home space. A seat figure here would show a
    // workspace number to somebody who is not in one.
    wallet: null,
    used: 0,
    limit: PERSONAL_MONTHLY_CREDITS,
    remaining: PERSONAL_MONTHLY_CREDITS,
    periodStart: "",
    periodEnd: "",
  },
  cancelAtPeriodEnd: false,
  subscription_period_end: null,
  has_stripe_customer: false,
};

/** `$23.97` — monthly total, no trailing `.00` stripping. */
export function formatMoney(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

/** Exported so the billing-status cache key can be targeted for invalidation
 *  (see `useInvalidateBillingStatus`). */
export const BILLING_STATUS_PATH = "/api/billing/status";

export function useWorkspaceEntitlements(workspaceId?: string) {
  const query = useApiQuery<WorkspaceEntitlementsStatus>(BILLING_STATUS_PATH, {
    workspaceId,
    // Members feature invalidates this key directly on add/remove (F-045,
    // `useInvalidateBillingStatus`). Short staleTime is the BACKSTOP for
    // membership changes no client initiates (invite accepted elsewhere, cron
    // seat reconcile) — vs. the 30s provider default.
    staleTime: 5_000,
  });
  // Degrades to Free rather than erroring — FIELD-WISE, not just row-wise.
  // ⚠ Query cache is IndexedDB-persisted with a 24h gcTime (§8), so a response
  // stored before a field shipped is replayed after it, and `credits.used` on
  // such a row is a crash, not a degrade. EVERY new field takes a fallback here.
  const raw = query.data ?? DEFAULT_STATUS;
  const data: WorkspaceEntitlementsStatus = {
    ...raw,
    credits: raw.credits
      ? // ⚠ FIELD-WISE INSIDE `credits` TOO. A row cached before `wallet`
        // shipped replays with the object present and the key missing, which
        // `raw.credits ?? …` cannot see — that is the exact shape of the stale
        // -cache bug the rule above exists for.
        { ...raw.credits, wallet: raw.credits.wallet ?? null }
      : DEFAULT_STATUS.credits,
    cancelAtPeriodEnd: raw.cancelAtPeriodEnd ?? false,
  };

  const isSolo = data.plan === "solo";
  const isTeam = data.plan === "team";
  const isPaid =
    (isSolo || isTeam) &&
    (data.status === "active" || data.status === "past_due");
  const isPastDue = data.status === "past_due";
  const isCapped = data.objectCap !== null;
  const overCap = isCapped && !data.canCreateObjects;

  // Live Stripe quantity when present, else member count (upgrade start).
  const billableSeats = data.seatCount ?? data.memberCount;
  // Solo flat; Team per-seat; Free projects a Team upgrade's cost.
  const monthlyTotal = isSolo ? SOLO_PRICE : billableSeats * TEAM_SEAT_PRICE;

  return {
    ...data,
    isPaid,
    isSolo,
    isTeam,
    isPastDue,
    isCapped,
    overCap,
    billableSeats,
    monthlyTotal,
    loading: query.isPending,
    refresh: query.refetch,
  };
}

export type WorkspaceEntitlements = ReturnType<typeof useWorkspaceEntitlements>;

/**
 * Invalidates every cached workspace billing-status read (all scopes share the
 * `BILLING_STATUS_PATH` prefix). Callers:
 * `src/features/members/hooks/use-member-writes.ts` (removal) and
 * `hooks/use-join-requests.ts` (approval), both from `onSuccess` — a FAILED
 * membership change moved no seats. ⚠ Sending an invitation deliberately does
 * NOT call it: an invite adds no member.
 */
export function useInvalidateBillingStatus() {
  const queryClient = useQueryClient();
  return useCallback(
    () => queryClient.invalidateQueries({ queryKey: [BILLING_STATUS_PATH] }),
    [queryClient]
  );
}
