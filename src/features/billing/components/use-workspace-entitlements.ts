"use client";

import { useApiQuery } from "@/shared/hooks/use-api-query";

/**
 * Client mirror of the workspace entitlements the `/api/billing/status`
 * endpoint returns (see `server/entitlements.ts`). THE single billing
 * read for every surface — settings pane, upgrade modal, pricing page,
 * ontology cap banners. Cached by TanStack Query (keyed by path +
 * workspace), no polling loops. Pass a `workspaceId` to scope the read;
 * omit it to let the endpoint fall back to the caller's default
 * workspace.
 *
 * Plans: "free" | "solo" | "team". Solo Pro is a flat $5.99/month for
 * single-member workspaces; Team is $7.99 per seat per month.
 */

export type WorkspacePlan = "free" | "solo" | "team";
export type BillingStatus = "free" | "active" | "past_due" | "canceled";

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

/** Solo Pro — flat monthly price, single-member workspaces only. */
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

export function useWorkspaceEntitlements(workspaceId?: string) {
  const query = useApiQuery<WorkspaceEntitlementsStatus>(
    "/api/billing/status",
    { workspaceId }
  );
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
