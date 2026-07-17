/**
 * Plan definitions — the single source for the settings-modal Plans &
 * Billing pane and the public /pricing page. Plans are WORKSPACE-level:
 * Free and Pro (billed $7.99 per seat per month, seats = workspace
 * members). Team is a "Custom / contact us" positioning column.
 * Checkout only sells the live per-seat Pro price; Free and Team are
 * positioning columns.
 */

export type PlanId = "free" | "pro" | "team";

export interface PlanDef {
  id: PlanId;
  audience: string;
  name: string;
  priceMonthly: string;
  priceNote: string;
  features: string[];
}

export const PLANS: ReadonlyArray<PlanDef> = [
  {
    id: "free",
    audience: "For individuals & small teams",
    name: "Free",
    priceMonthly: "Free",
    priceNote: "",
    features: [
      "Unlimited usage on your own",
      "Every feature included",
      "Up to 1,000 ontology objects (cards and columns) once a workspace has 2+ members",
      "90 days of chat history",
      "Community support",
    ],
  },
  {
    id: "pro",
    audience: "For growing teams",
    name: "Pro",
    priceMonthly: "$7.99",
    priceNote: "/ seat / month",
    features: [
      "Everything in Free",
      "Uncapped ontology objects",
      "Full chat history",
      "Priority support",
      "Billed per member — seats sync automatically",
    ],
  },
  {
    id: "team",
    audience: "For teams with advanced needs",
    name: "Team",
    priceMonthly: "Custom",
    priceNote: "",
    features: [
      "Everything in Pro",
      "SSO / SAML",
      "Advanced roles & access control",
      "Audit logs",
      "Dedicated support",
    ],
  },
];
