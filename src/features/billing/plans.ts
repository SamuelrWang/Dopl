/**
 * Plan definitions — single source for the Plans & Billing pane and /pricing.
 * Plans are WORKSPACE-level. Checkout sells solo (flat, quantity 1) and team
 * (per-seat) against their live Stripe prices.
 *
 * ⚠ THE FEATURE STRINGS ARE INTERPOLATED, NOT TYPED (2026-08-30, G4). They
 * restated `credits.ts › MONTHLY_MCP_CREDITS` and the free caps in prose, in
 * TWO more places (`marketing/components/pricing-content.tsx › COMPARE_ROWS`
 * was the third), and drift there is PUBLIC PRICING MISREPRESENTATION that no
 * test could see — a string is a string. Interpolating deletes the duplicate
 * rather than gating it, which is the cheaper of the two fixes.
 * `server/entitlements.ts › entitlementDeniedBody` already did this.
 */

// ⚠ NOT A CYCLE. `credits.ts` reaches back for `PlanId` with `import type`,
// which is erased — the only runtime edge is this one, plans → credits.
import { MONTHLY_MCP_CREDITS } from "./credits";

export type PlanId = "free" | "solo" | "team";

/**
 * Thousands separators for a number that renders in COPY.
 *
 * ⚠ LOCALE-PINNED ON PURPOSE. A bare `toLocaleString()` reads the RUNTIME's
 * locale, which is the server's during SSR and the reader's in the browser — so
 * `10,000` and `10.000` would be rendered into the same slot and React would
 * report a hydration mismatch on the pricing page. The copy around it is
 * English; the number matches it.
 */
export function planNumber(value: number): string {
  return value.toLocaleString("en-US");
}

/**
 * FREE-PLAN CAPACITY, and the reason these two live HERE rather than beside the
 * gate that enforces them.
 *
 * `server/entitlements.ts` — the enforcement site, and their previous home —
 * opens with `import "server-only"`, so nothing that renders could read them and
 * every public surface restated the numbers as prose instead. They are plan
 * FACTS, they are quoted to the public, and this module is the one both sides
 * can import. ⚠ `entitlements.ts` RE-EXPORTS them, so every existing importer
 * (and every `vi.mock` of that module) is unchanged and the gate still reads
 * exactly one definition.
 */

/** Ontology objects a MULTI-member free workspace may hold. 1-member free is
 *  uncapped, and the cap freezes CREATES only — reads/edits/exports never. */
export const FREE_MULTI_MEMBER_OBJECT_CAP = 100;

/** Days of chat history a free workspace can SEE. Hide, never delete. */
export const FREE_CHATS_WINDOW_DAYS = 90;

/**
 * Canonical workspace billing status. "free" = no live subscription; paid
 * states mirror Stripe. Single source for the entitlements contract so the
 * union isn't hand-redeclared per module.
 */
export type BillingStatus = "free" | "active" | "past_due" | "canceled";

export interface PlanDef {
  id: PlanId;
  name: string;
  priceMonthly: string;
  priceNote: string;
  features: string[];
}

/** The credits line, worded once for all three cards. */
const creditsFeature = (plan: PlanId) =>
  `${planNumber(MONTHLY_MCP_CREDITS[plan])} MCP credits / month`;

export const PLANS: ReadonlyArray<PlanDef> = [
  {
    id: "free",
    name: "Starter",
    priceMonthly: "Free",
    priceNote: "",
    features: [
      "Every feature included — no gates",
      "Unlimited ontology objects while you work solo",
      `Teams of 2+: up to ${planNumber(FREE_MULTI_MEMBER_OBJECT_CAP)} ontology objects`,
      `${FREE_CHATS_WINDOW_DAYS} days of chat history`,
      creditsFeature("free"),
      "Community support",
    ],
  },
  {
    id: "solo",
    name: "Pro",
    priceMonthly: "$5.99",
    priceNote: "/ month",
    features: [
      "Unlimited ontology objects",
      "Full chat history",
      creditsFeature("solo"),
      "Priority support",
      "Single-member workspace — upgrade to Team anytime",
    ],
  },
  {
    id: "team",
    name: "Team",
    priceMonthly: "$7.99",
    priceNote: "/ seat / month",
    features: [
      "Unlimited ontology objects for the whole workspace",
      "Full chat history for everyone",
      creditsFeature("team"),
      "Priority support",
      "Seats sync automatically as members join or leave",
    ],
  },
];
