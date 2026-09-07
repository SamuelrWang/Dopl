"use client";

import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useApiQuery } from "@/shared/hooks/use-api-query";
import type { WorkspaceKind } from "@/features/workspaces/types";
import type { PlanId, BillingStatus } from "../plans";
import { PERSONAL_MONTHLY_CREDITS, type WalletKind } from "../credits";
import { PRO_PRICE, SOLO_PRICE, TEAM_SEAT_PRICE, formatMoney } from "../prices";

/**
 * Client mirror of `/api/billing/status` (see `server/entitlements.ts`) — THE
 * single billing read for every surface. Omitting `workspaceId` lets the
 * endpoint resolve the caller's own container.
 *
 * TWO PAID PLANS, ON TWO DIFFERENT KINDS OF CONTAINER (Samuel, 2026-09-08):
 * **Team** — per seat, per month, on a standard workspace, each member with
 * their own fixed non-pooled allocation; **Pro** — flat, per month, on the
 * caller's `kind='personal'` container, for their home space. `containerKind`
 * says which one this payload is even about.
 *
 * ⚠ Pro/Solo — flat $5.99, one member, a STANDARD workspace — is RETIRED FROM
 * SALE and is NOT the `pro` plan; `SOLO_PRICE` and `isSolo` survive to LABEL
 * the rows still on it, and nothing here offers it.
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
  /** Workspace or home space — which plan list and which wording apply.
   *  ⚠ Shipped 2026-09-08; a cached row from before it has NO such key, hence
   *  the field-wise fallback below (INVARIANTS §8). */
  containerKind: WorkspaceKind;
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

/**
 * ⚠ **DEFINED IN `../prices.ts`, RE-EXPORTED HERE (2026-09-08, F-672
 * RESOLVED).** These three and `formatMoney` used to be DECLARED in this file —
 * a `"use client"` React module — so `../plans.ts` could not import them and
 * wrote `"$8.00"` as a string literal on the public pricing card instead. They
 * moved to a pure module both sides can read; the re-export keeps every
 * existing importer (`shared/layout/settings-modal/sections/*`,
 * `components/upgrade-modal*.tsx`, `marketing/components/pricing-content.tsx`)
 * and every `vi.mock` of this module working unchanged, and there is now
 * exactly one definition of each number.
 */
export { PRO_PRICE, SOLO_PRICE, TEAM_SEAT_PRICE, formatMoney };

const DEFAULT_STATUS: WorkspaceEntitlementsStatus = {
  plan: "free",
  status: "free",
  // ⚠ `standard` matches `workspaces/types.ts › isStandardWorkspace`'s default
  // for an absent kind, and is the conservative pre-response guess: a workspace
  // renderer on a home space shows one card too many, the reverse hides the
  // Team card from a workspace admin who came to buy it.
  containerKind: "standard",
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
    // ⚠ `.free` SINCE 2026-09-08: `PERSONAL_MONTHLY_CREDITS` became a map when
    // the personal Pro tier landed. FREE is the right key for a default — this
    // renders before any response says whether the viewer pays, and showing a
    // paid allowance to a free user is the direction that misleads.
    limit: PERSONAL_MONTHLY_CREDITS.free,
    remaining: PERSONAL_MONTHLY_CREDITS.free,
    periodStart: "",
    periodEnd: "",
  },
  cancelAtPeriodEnd: false,
  subscription_period_end: null,
  has_stripe_customer: false,
};

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
    // ⚠ A row cached before 2026-09-08 has no `containerKind`. `standard` is
    // the same default the server stamps for an absent workspace kind, so a
    // replayed row renders the workspace surfaces it was captured on.
    containerKind: raw.containerKind ?? "standard",
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
  /** The PERSONAL paid tier — flat, on the caller's own home container. */
  const isPro = data.plan === "pro";
  const isPaid =
    (isSolo || isTeam || isPro) &&
    (data.status === "active" || data.status === "past_due");
  const isPastDue = data.status === "past_due";
  const isCapped = data.objectCap !== null;
  const overCap = isCapped && !data.canCreateObjects;

  // Live Stripe quantity when present, else member count (upgrade start).
  const billableSeats = data.seatCount ?? data.memberCount;
  // ⚠ TWO FLAT PLANS AND ONE PER-SEAT ONE. Solo (legacy) and Pro (personal) are
  // one price however many rows the container has; Team multiplies. A FREE
  // container projects a TEAM upgrade's cost, which is only meaningful on a
  // standard workspace — the personal surfaces render `PRO_PRICE` directly and
  // never this figure (`containerKind` says which surface is which).
  const monthlyTotal = isPro
    ? PRO_PRICE
    : isSolo
      ? SOLO_PRICE
      : billableSeats * TEAM_SEAT_PRICE;

  return {
    ...data,
    isPaid,
    isSolo,
    isTeam,
    isPro,
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
