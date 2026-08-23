"use client";

import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useApiQuery } from "@/shared/hooks/use-api-query";
import type { PlanId, BillingStatus } from "../plans";
import { MONTHLY_MCP_CREDITS } from "../credits";

/**
 * Client mirror of `/api/billing/status` (see `server/entitlements.ts`) — THE
 * single billing read for every surface. Omitting `workspaceId` lets the
 * endpoint fall back to the caller's default workspace.
 *
 * Pro = flat $5.99/mo, single-member only; Team = $7.99 per seat per month.
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
  used: number;
  limit: number;
  remaining: number;
  periodStart: string;
  periodEnd: string;
  /** Present only when the zeroes were NOT measured — a link container whose
   *  caller has no billing workspace runs unmetered
   *  (`server/credits-service.ts › unmetered`). */
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

/** Pro — flat monthly price, single-member workspaces only. */
export const SOLO_PRICE = 5.99;
/** Team — per seat per month, seats sync with membership. */
export const TEAM_SEAT_PRICE = 7.99;

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
    used: 0,
    limit: MONTHLY_MCP_CREDITS.free,
    remaining: MONTHLY_MCP_CREDITS.free,
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
    credits: raw.credits ?? DEFAULT_STATUS.credits,
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
