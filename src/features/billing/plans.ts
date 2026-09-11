/**
 * Plan definitions — single source for the Plans & Billing pane and /pricing.
 *
 * 🔒 **TWO PLAN GROUPS SINCE 2026-09-08, BECAUSE THERE ARE TWO KINDS OF THING
 * TO BILL** (Samuel's $8.99 ruling; spec §11). A STANDARD workspace is sold by
 * the seat (`WORKSPACE_PLANS` — Starter / Team); a `kind='personal'` container
 * is sold flat, to one person, for their home space (`PERSONAL_PLANS` — Free /
 * Pro). `plansForKind` picks, and NO SURFACE MAY CONCATENATE THE TWO: a
 * personal container cannot buy seats and a workspace cannot buy Pro
 * (`POST /api/billing/checkout` → 400 `PLAN_NOT_FOR_CONTAINER`), so a card the
 * viewer cannot buy is a button that 400s.
 *
 * 🔒 **THE SOLO CARD IS GONE, THE `solo` PLAN ID IS NOT (2026-09-07, Samuel's
 * two-tier ruling).** Solo — flat $5.99, one member, a STANDARD workspace — is
 * RETIRED FROM SALE: no card in either group, no checkout, no upgrade copy.
 * Live `solo` rows keep working as a legacy paid workspace until they cancel or
 * switch, so `PlanId` still carries the value and `SEAT_MONTHLY_CREDITS` still
 * answers for it. A plan you cannot buy is not the same as a plan nobody is on.
 * ⚠ It wore the LABEL "Pro" in the UI until 2026-09-07 and is NOT the `pro`
 * plan added the next day — different price, different container, different
 * direction (one retired, one on sale).
 *
 * ⚠ THE FEATURE STRINGS ARE INTERPOLATED, NOT TYPED (2026-08-30, G4). They
 * restated the credit allowance and the free caps in prose, in TWO more places
 * (`marketing/components/pricing-content.tsx › COMPARE_ROWS` was the third), and
 * drift there is PUBLIC PRICING MISREPRESENTATION that no test could see — a
 * string is a string. Interpolating deletes the duplicate rather than gating it,
 * which is the cheaper of the two fixes.
 * `server/entitlements.ts › entitlementDeniedBody` already did this.
 * ⚠ **AND THE PRICES ARE INTERPOLATED TOO SINCE 2026-09-08 (F-672 RESOLVED).**
 * `priceMonthly` was the STRING `"$8.00"`, because the price constants lived in
 * a `"use client"` React module this one cannot import. They live in
 * `./prices.ts` now — a pure module both halves read — so every figure below
 * comes through `formatMoney(...)` / `planNumber(...)` and there is no literal
 * dollar amount or credit count in this file's prose.
 */

// ⚠ NOT A CYCLE. `credits.ts` reaches back for `PlanId` with `import type`,
// which is erased — the only runtime edge is this one, plans → credits.
import { PERSONAL_MONTHLY_CREDITS, SEAT_MONTHLY_CREDITS } from "./credits";
import { formatMoney, PRO_PRICE, TEAM_SEAT_PRICE } from "./prices";
import type { WorkspaceKind } from "@/features/workspaces/types";

/**
 * The billing taxonomy. ⚠ **FOUR VALUES, AND EACH IS SCOPED TO A CONTAINER
 * KIND** — `team` is sold only on a standard workspace, `pro` (2026-09-08) only
 * on a `kind='personal'` container, `solo` is a retired standard plan that is
 * sold nowhere, and `free` is the absence of a live subscription on either.
 * Mirrored by the database in `workspace_billing_plan_check`
 * (`20260930130000_workspace_billing_plan_pro.sql`): a value here that the
 * CHECK lacks is a `23514` inside the Stripe webhook, which retries forever.
 */
export type PlanId = "free" | "solo" | "team" | "pro";

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
 * The SEAT credits line, worded once for both workspace cards.
 *
 * ⚠ **"per member" IS LOAD-BEARING COPY, NOT DECORATION.** The allowance is a
 * fixed per-person allocation, not a workspace pool (`credits.ts ›
 * SEAT_MONTHLY_CREDITS`), and a card that said "5,000 credits / month" beside
 * "Unlimited members" would read as the pool it is not.
 */
const seatCreditsFeature = (plan: PlanId) =>
  `${planNumber(SEAT_MONTHLY_CREDITS[plan])} credits per member / month`;

/**
 * The PERSONAL credits line. ⚠ Deliberately NOT "per member": a personal
 * container has exactly one member by construction, so "per member" there would
 * imply a roster that cannot exist and invite the reader to multiply.
 */
const personalCreditsFeature = (tier: "free" | "pro") =>
  `${planNumber(PERSONAL_MONTHLY_CREDITS[tier])} credits / month`;

/**
 * STANDARD-WORKSPACE plans — Starter and Team.
 *
 * ⚠ TWO CARDS SINCE 2026-09-07, AND THE LENGTH IS A CONTRACT SOME SURFACE
 * RENDERS. The Solo/Pro card is deleted (retired from sale); the id survives on
 * `PlanId` for legacy rows only, and nothing here offers it.
 */
export const WORKSPACE_PLANS: ReadonlyArray<PlanDef> = [
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
      seatCreditsFeature("free"),
      "Community support",
    ],
  },
  {
    id: "team",
    name: "Team",
    priceMonthly: formatMoney(TEAM_SEAT_PRICE),
    priceNote: "/ seat / month",
    features: [
      "Unlimited members",
      "Unlimited ontology objects for the whole workspace",
      "Full chat history for everyone",
      seatCreditsFeature("team"),
      "Priority support",
      "Seats sync automatically as members join or leave",
    ],
  },
];

/**
 * PERSONAL-CONTAINER plans — Free and Pro (2026-09-08, spec §11.1).
 *
 * ⚠ **NO MEMBER LINE ON EITHER CARD, AND NO SEAT WORDING.** A personal
 * container is one person's home space with exactly one member
 * (`20260920120000_workspace_kind_personal.sql`); "Unlimited members" is a
 * workspace promise and reads here as an invitation to do something the
 * container refuses (`server/entitlements.ts › assertCanAddMember`).
 *
 * ⚠ The object cap never applies: it is a MULTI-member free rule, and a
 * personal container cannot be multi-member — so neither card quotes it.
 */
export const PERSONAL_PLANS: ReadonlyArray<PlanDef> = [
  {
    id: "free",
    name: "Free",
    priceMonthly: "Free",
    priceNote: "",
    features: [
      "Every feature included — no gates",
      "Unlimited ontology objects",
      `${FREE_CHATS_WINDOW_DAYS} days of chat history`,
      personalCreditsFeature("free"),
      "Community support",
    ],
  },
  {
    id: "pro",
    name: "Pro",
    priceMonthly: formatMoney(PRO_PRICE),
    priceNote: "/ month",
    features: [
      "Unlimited ontology objects",
      "Full chat history",
      personalCreditsFeature("pro"),
      "Priority support",
    ],
  },
];

/**
 * The plans a container of this kind may be shown, and the ONLY correct way to
 * choose between the two groups.
 *
 * ⚠ **`link` FALLS TO THE WORKSPACE GROUP AND THAT IS NOT A BUG** — a
 * `kind='link'` home channel carries no plan at all and no billing surface
 * renders one, so the arm is unreachable in practice. It answers the WORKSPACE
 * group rather than the personal one because an unknown kind must not be
 * offered a checkout that 400s: `pro` is refused for anything but `personal`.
 * ⚠ An absent kind (a row read before `20260920120000` applied) is `standard`,
 * the same default `workspaces/types.ts › isStandardWorkspace` takes.
 */
export function plansForKind(
  kind: WorkspaceKind | undefined
): ReadonlyArray<PlanDef> {
  return kind === "personal" ? PERSONAL_PLANS : WORKSPACE_PLANS;
}
