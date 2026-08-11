/**
 * Plan definitions — the single source for the settings-modal Plans &
 * Billing pane and the public /pricing page. Plans are WORKSPACE-level and
 * all three are real, purchasable plans now:
 *   - Starter: full features; solo work is uncapped, teams of 2+ get a
 *     100-object cap and a 90-day chat window.
 *   - Pro: $5.99/month flat, single-member workspaces only.
 *   - Team: $7.99 per seat / month, seats sync to member count.
 * Checkout sells both paid plans — Solo (flat, quantity 1) and Team
 * (per-seat) — via their live Stripe prices.
 */

export type PlanId = "free" | "solo" | "team";

/**
 * Canonical billing/subscription status for a workspace. "free" = no live
 * subscription; the paid states mirror Stripe (active / past_due / canceled).
 * Single source for the entitlements contract (server + client mirror) so
 * the union isn't hand-redeclared per module.
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
