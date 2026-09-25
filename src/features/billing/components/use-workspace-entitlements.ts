"use client";

import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useApiQuery } from "@/shared/hooks/use-api-query";
import type { WorkspaceKind } from "@/features/workspaces/types";
import type { PlanId, BillingStatus } from "../plans";
import { PERSONAL_MONTHLY_CREDITS, type WalletKind } from "../credits";
import { PRO_PRICE, SOLO_PRICE, TEAM_SEAT_PRICE, formatMoney } from "../prices";

/**
 * Client mirror of `/api/billing/status` (see `server/entitlements.ts`) — the
 * single billing read for every surface. Omitting `workspaceId` lets the
 * endpoint resolve the caller's own container.
 *
 * 2026-09-08: two paid plans on two kinds of container — Team (per seat, on a
 * standard workspace) and Pro (flat, on the caller's `kind='home'`
 * container). `containerKind` says which one a payload is about. Retired Solo
 * is not `pro`; `SOLO_PRICE` and `isSolo` survive only to label legacy rows.
 */

/** Aliases of the canonical taxonomy (plans.ts), so importers don't couple to
 *  it directly. */
export type WorkspacePlan = PlanId;
export type { BillingStatus };

/**
 * MCP credit meter for the CURRENT billing period; allowances in
 * `../credits.ts`. `periodStart`/`periodEnd` are ISO instants — subscription
 * anchor when paid, UTC calendar month otherwise.
 */
export interface WorkspaceCreditsStatus {
  /** Which wallet these numbers came off: `seat` inside a standard workspace,
   *  `home` in the caller's home space. `null` on a degraded reading and on
   *  a cached row stored before the field shipped — the fallback below is not
   *  optional (INVARIANTS §8). */
  wallet: WalletKind | null;
  used: number;
  limit: number;
  remaining: number;
  periodStart: string;
  periodEnd: string;
  /** Present only when the zeroes were not measured — a non-owner peer in
   *  somebody's link container, a container with no active owner, and the
   *  route's own fail-open (`server/credits-service.ts › unmetered`,
   *  `server/status-service.ts`). */
  degraded?: true;
  /**
   * `counter - SUM(ledger)` for this wallet and period; 0 = reconciled
   * (2026-09-13, F-693). Non-zero means the two records of this wallet's spend
   * disagree — unreachable for rows written after
   * `20261004120000_credit_consume_with_ledger.sql`, and not undoable for rows
   * written before it.
   *
   * Not a meter and not a second `used`: the one surface that reads it prints a
   * single muted word (`pages/home/overview-sections.tsx › CreditCapacityBar`).
   * Shipped 2026-09-13, so it takes a `?? 0` fallback below (INVARIANTS §8) —
   * 0 is also what the server sends when it could not reconcile.
   */
  ledgerDrift: number;
  /**
   * ISO-8601 instant when the server process that answered this read first
   * failed open on a charge and has not recovered, else `null` (2026-09-14).
   * The consume route fails open by decision, so a dead RPC runs every MCP tool
   * call unmetered while this meter reads the same `0` a quiet month reads.
   *
   * Process-local (`billing/server/credits-unmetered.ts` has the full
   * limitation): `null` means "not the instance that served this read", never
   * "not happening". Shipped 2026-09-14, so it takes a `?? null` fallback below
   * (INVARIANTS §8) — `null` is also what a normally-metering server sends.
   */
  unmeteredSince: string | null;
}

export interface WorkspaceEntitlementsStatus {
  plan: WorkspacePlan;
  status: BillingStatus;
  /** Workspace or home space — which plan list and which wording apply.
   *  Shipped 2026-09-08; a cached row from before it has no such key, hence the
   *  field-wise fallback below (INVARIANTS §8). */
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
 * Defined in `../prices.ts`, re-exported here (2026-09-08, F-672 resolved).
 * They were declared in this `"use client"` module, which `../plans.ts` could
 * not import, so it hard-coded `"$8.00"` on the public pricing card. The
 * re-export keeps existing importers and every `vi.mock` of this module working
 * unchanged.
 */
export { PRO_PRICE, SOLO_PRICE, TEAM_SEAT_PRICE, formatMoney };

const DEFAULT_STATUS: WorkspaceEntitlementsStatus = {
  plan: "free",
  status: "free",
  // `standard` matches `workspaces/types.ts › isStandardWorkspace`'s default for
  // an absent kind, and is the conservative pre-response guess: a workspace
  // renderer on a home space shows one card too many, the reverse hides the
  // Team card from a workspace admin who came to buy it.
  containerKind: "standard",
  memberCount: 1,
  seatCount: null,
  objectCap: null,
  objectsUsed: 0,
  canCreateObjects: true,
  chatsWindowDays: 90,
  // The free allowance, nothing spent. Period bounds are blank on purpose:
  // this fallback measured nothing, so an invented window would be a number
  // with no measurement behind it.
  credits: {
    // The personal allowance, not a plan's: this renders before the first
    // response lands, most often on the caller's own home space, and a seat
    // figure would show a workspace number to somebody not in one.
    wallet: null,
    used: 0,
    // `.free` since 2026-09-08, when `PERSONAL_MONTHLY_CREDITS` became a map:
    // this renders before any response says whether the viewer pays, and
    // showing a paid allowance to a free user is the misleading direction.
    limit: PERSONAL_MONTHLY_CREDITS.free,
    remaining: PERSONAL_MONTHLY_CREDITS.free,
    periodStart: "",
    periodEnd: "",
    // Nothing was read, so nothing disagrees; 0 is "reconciled".
    ledgerDrift: 0,
    // `null` is the only honest pre-response value — printing "Unmetered"
    // before any server has spoken would accuse a healthy deployment.
    unmeteredSince: null,
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
    // Members invalidates this key directly on add/remove (F-045,
    // `useInvalidateBillingStatus`). The short staleTime is the backstop for
    // membership changes no client initiates (invite accepted elsewhere, cron
    // seat reconcile) — vs. the 30s provider default.
    staleTime: 5_000,
  });
  // Degrades to Free rather than erroring — field-wise, not just row-wise. The
  // query cache is IndexedDB-persisted with a 24h gcTime (§8), so a response
  // stored before a field shipped is replayed after it, and `credits.used` on
  // such a row is a crash, not a degrade. Every new field takes a fallback here.
  const raw = query.data ?? DEFAULT_STATUS;
  const data: WorkspaceEntitlementsStatus = {
    ...raw,
    // A row cached before 2026-09-08 has no `containerKind`. `standard` is the
    // same default the server stamps for an absent workspace kind, so a
    // replayed row renders the workspace surfaces it was captured on.
    containerKind: raw.containerKind ?? "standard",
    credits: raw.credits
      ? // Field-wise inside `credits` too: a row cached before `wallet` shipped
        // replays with the object present and the key missing, which
        // `raw.credits ?? …` cannot see.
        {
          ...raw.credits,
          wallet: raw.credits.wallet ?? null,
          // Shipped 2026-09-13 — same shape: a replayed row has the `credits`
          // object and not this key, and `0` is "reconciled".
          ledgerDrift: raw.credits.ledgerDrift ?? 0,
          // Shipped 2026-09-14 — `null` is "metering normally", so a replayed
          // row never prints the word.
          unmeteredSince: raw.credits.unmeteredSince ?? null,
        }
      : DEFAULT_STATUS.credits,
    cancelAtPeriodEnd: raw.cancelAtPeriodEnd ?? false,
  };

  const isSolo = data.plan === "solo";
  const isTeam = data.plan === "team";
  /** The personal paid tier — flat, on the caller's own home container. */
  const isPro = data.plan === "pro";
  const isPaid =
    (isSolo || isTeam || isPro) &&
    (data.status === "active" || data.status === "past_due");
  const isPastDue = data.status === "past_due";
  const isCapped = data.objectCap !== null;
  const overCap = isCapped && !data.canCreateObjects;

  // Live Stripe quantity when present, else member count (upgrade start).
  const billableSeats = data.seatCount ?? data.memberCount;
  // Two flat plans and one per-seat one: Solo (legacy) and Pro (personal) are
  // one price however many rows the container has; Team multiplies. A free
  // container projects a Team upgrade's cost, meaningful only on a standard
  // workspace — personal surfaces render `PRO_PRICE` directly, never this.
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
 * `BILLING_STATUS_PATH` prefix). Called from `onSuccess` only — a failed
 * membership change moved no seats — and deliberately not on invite send, since
 * an invite adds no member.
 */
export function useInvalidateBillingStatus() {
  const queryClient = useQueryClient();
  return useCallback(
    () => queryClient.invalidateQueries({ queryKey: [BILLING_STATUS_PATH] }),
    [queryClient]
  );
}
