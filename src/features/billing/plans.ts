/**
 * Plan definitions — single source for the Plans & Billing pane and /pricing.
 * Plans are WORKSPACE-level. Checkout sells solo (flat, quantity 1) and team
 * (per-seat) against their live Stripe prices.
 */

export type PlanId = "free" | "solo" | "team";

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

export const PLANS: ReadonlyArray<PlanDef> = [
  {
    id: "free",
    name: "Starter",
    priceMonthly: "Free",
    priceNote: "",
    features: [
      "Every feature included — no gates",
      "Unlimited ontology objects while you work solo",
      "Teams of 2+: up to 100 ontology objects",
      "90 days of chat history",
      "500 MCP credits / month",
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
      "10,000 MCP credits / month",
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
      "25,000 MCP credits / month",
      "Priority support",
      "Seats sync automatically as members join or leave",
    ],
  },
];
