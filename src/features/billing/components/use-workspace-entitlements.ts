"use client";

import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useApiQuery } from "@/shared/hooks/use-api-query";
import type { PlanId, BillingStatus } from "../plans";

/**
 * Client mirror of the workspace entitlements the `/api/billing/status`
 * endpoint returns (see `server/entitlements.ts`). THE single billing
 * read for every surface — settings pane, upgrade modal, pricing page,
 * ontology cap banners. Cached by TanStack Query (keyed by path +
 * workspace), no polling loops. Pass a `workspaceId` to scope the read;
 * omit it to let the endpoint fall back to the caller's default
 * workspace.
 *
 * Plans: "free" | "solo" | "team". Pro is a flat $5.99/month for
 * single-member workspaces; Team is $7.99 per seat per month.
 */

/** Aliases of the canonical taxonomy (plans.ts) — kept as this mirror's
 *  public names so importers don't couple to plans.ts directly. */
export type WorkspacePlan = PlanId;
export type { BillingStatus };

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
  subscription_period_end: null,
  has_stripe_customer: false,
};

/** `$23.97` — a monthly total, no trailing `.00` stripping. */
export function formatMoney(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

/** Query path for the workspace billing/entitlements read. Exported so the
 *  billing-status cache key can be targeted for invalidation (see
 *  `useInvalidateBillingStatus`). */
export const BILLING_STATUS_PATH = "/api/billing/status";

export function useWorkspaceEntitlements(workspaceId?: string) {
  const query = useApiQuery<WorkspaceEntitlementsStatus>(BILLING_STATUS_PATH, {
    workspaceId,
    // seatCount / memberCount change when members are added or removed, and
    // since F-045 the members feature invalidates this key directly on both
    // (`useInvalidateBillingStatus`, called from the join-request approval and
    // the member removal). The short staleTime stays as the BACKSTOP for the
    // membership changes no client initiates — an invite accepted in another
    // session, a seat reconciled by cron — versus the 30s provider default.
    staleTime: 5_000,
  });
  // Billing UI degrades to Free rather than erroring.
  const data = query.data ?? DEFAULT_STATUS;

  const isSolo = data.plan === "solo";
  const isTeam = data.plan === "team";
  // Entitled = on a paid plan with a live (or grace-period) subscription.
  const isPaid =
    (isSolo || isTeam) &&
    (data.status === "active" || data.status === "past_due");
  const isPastDue = data.status === "past_due";
  const isCapped = data.objectCap !== null;
  const overCap = isCapped && !data.canCreateObjects;

  // Seats we'd bill / project: the live Stripe quantity when present,
  // otherwise the current member count (what an upgrade would start at).
  const billableSeats = data.seatCount ?? data.memberCount;
  // Solo is flat; Team is per-seat; Free projects what a Team upgrade
  // would cost (the figure every upgrade surface quotes).
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
 * Returns a callback that invalidates every cached workspace billing-status
 * read (all workspace scopes share the `BILLING_STATUS_PATH` key prefix).
 * Call it after a member add / remove so seat and member counts refresh
 * immediately rather than waiting out the staleTime.
 *
 * WIRED (F-045, closed): `src/features/members/hooks/use-member-writes.ts`
 * calls it after a member REMOVAL and `hooks/use-join-requests.ts` after an
 * APPROVAL — the two writes in this app that change `workspace_members` from
 * the client. Both call it from `onSuccess` rather than the mutation layer's
 * `invalidate`, because a membership change that FAILED moved no seats and
 * re-downloading the entitlements would be a wasted round trip. Sending an
 * invitation deliberately does NOT call it: an invite adds no member, and
 * seats reconcile against membership.
 */
export function useInvalidateBillingStatus() {
  const queryClient = useQueryClient();
  return useCallback(
    () => queryClient.invalidateQueries({ queryKey: [BILLING_STATUS_PATH] }),
    [queryClient]
  );
}
