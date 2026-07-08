/**
 * Plan definitions — the single source for the settings-modal Plans &
 * Billing pane and the public /pricing page. Checkout itself only sells
 * the live monthly Pro price; Basic and Team are positioning columns.
 */

export type PlanId = "basic" | "pro" | "team";

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
    id: "basic",
    audience: "For individuals",
    name: "Basic",
    priceMonthly: "Free",
    priceNote: "",
    features: [
      "1 workspace",
      "Up to 3 knowledge bases",
      "Core skills library",
      "Connect 1 MCP client",
      "Community support",
    ],
  },
  {
    id: "pro",
    audience: "For individuals and teams",
    name: "Pro",
    priceMonthly: "$7.99",
    priceNote: "per month",
    features: [
      "Everything in Basic",
      "Unlimited knowledge bases & skills",
      "Unlimited MCP clients",
      "Team collaboration",
      "Priority support",
      "Early access to new features",
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
      "Advanced roles & access control",
      "SSO / SAML",
      "Audit logs",
      "Dedicated support",
      "Custom onboarding",
    ],
  },
];
