/**
 * Plan definitions — single source for the Plans & Billing pane and /pricing.
 * Plans are WORKSPACE-level and there are TWO of them: Starter (free) and Team
 * ($8 per seat). Checkout sells `team` only.
 *
 * 🔒 **THE SOLO CARD IS GONE, THE `solo` PLAN ID IS NOT (2026-09-07, Samuel's
 * two-tier ruling).** Pro/Solo — flat $5.99, one member — is RETIRED FROM SALE:
 * no card here, no checkout, no upgrade copy. Live `solo` rows keep working as a
 * legacy paid workspace until they cancel or switch, so `PlanId` still carries
 * the value and `SEAT_MONTHLY_CREDITS` still answers for it. A plan you cannot
 * buy is not the same as a plan nobody is on.
 *
 * ⚠ THE FEATURE STRINGS ARE INTERPOLATED, NOT TYPED (2026-08-30, G4). They
 * restated the credit allowance and the free caps in prose, in TWO more places
 * (`marketing/components/pricing-content.tsx › COMPARE_ROWS` was the third), and
 * drift there is PUBLIC PRICING MISREPRESENTATION that no test could see — a
 * string is a string. Interpolating deletes the duplicate rather than gating it,
 * which is the cheaper of the two fixes.
 * `server/entitlements.ts › entitlementDeniedBody` already did this.
 */

// ⚠ NOT A CYCLE. `credits.ts` reaches back for `PlanId` with `import type`,
// which is erased — the only runtime edge is this one, plans → credits.
import { SEAT_MONTHLY_CREDITS } from "./credits";

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

/**
 * The credits line, worded once for both cards.
 *
 * ⚠ **"per member" IS LOAD-BEARING COPY, NOT DECORATION.** The allowance is a
 * fixed per-person allocation, not a workspace pool (`credits.ts ›
 * SEAT_MONTHLY_CREDITS`), and a card that said "5,000 credits / month" beside
 * "Unlimited members" would read as the pool it is not.
 */
const creditsFeature = (plan: PlanId) =>
  `${planNumber(SEAT_MONTHLY_CREDITS[plan])} credits per member / month`;

/**
 * ⚠ TWO CARDS SINCE 2026-09-07, AND `PLANS.length` IS A CONTRACT SOME SURFACE
 * RENDERS. The Solo/Pro card is deleted (retired from sale); the id survives on
 * `PlanId` for legacy rows only, and nothing here offers it.
 */
export const PLANS: ReadonlyArray<PlanDef> = [
  {
    id: "free",
    name: "Starter",
    priceMonthly: "Free",
    priceNote: "",
    features: [
      "Every feature included — no gates",
      "Unlimited members",
      "Unlimited ontology objects while you work solo",
      `Teams of 2+: up to ${planNumber(FREE_MULTI_MEMBER_OBJECT_CAP)} ontology objects`,
      `${FREE_CHATS_WINDOW_DAYS} days of chat history`,
      creditsFeature("free"),
      "Community support",
    ],
  },
  {
    id: "team",
    name: "Team",
    // ⚠ DISPLAY ONLY, AND STRIPE DOES NOT AGREE YET. The live per-seat price
    // under `STRIPE_PRO_SEAT_PRICE_ID` is still $7.99; Samuel creates the $8
    // price and flips the env, and no code here touches a Stripe price. Deploy
    // state is a measurement (CLAUDE.md): read the env, do not trust this line.
    priceMonthly: "$8.00",
    priceNote: "/ seat / month",
    features: [
      "Unlimited members",
      "Unlimited ontology objects for the whole workspace",
      "Full chat history for everyone",
      creditsFeature("team"),
      "Priority support",
      "Seats sync automatically as members join or leave",
    ],
  },
];
