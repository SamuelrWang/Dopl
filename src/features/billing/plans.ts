/**
 * Plan definitions — single source for the Plans & Billing pane and /pricing.
 *
 * 2026-09-08: two plan groups, because there are two kinds of thing to bill.
 * A standard workspace is sold by the seat (`WORKSPACE_PLANS`); a
 * `kind='home'` container is sold flat (`PERSONAL_PLANS`). `plansForKind`
 * picks; no surface may concatenate the two, since checkout answers 400
 * `PLAN_NOT_FOR_CONTAINER` for the wrong pairing.
 * 2026-09-07: the Solo card is retired from sale but the `solo` plan id is not
 * — live rows keep working, so `PlanId` and `SEAT_MONTHLY_CREDITS` still answer
 * for it. It wore the label "Pro" until 2026-09-07 and is not the `pro` plan
 * added the next day.
 *
 * Feature strings and prices are interpolated, not typed (2026-08-30 G4;
 * F-672 resolved 2026-09-08): a restated allowance or price drifts into public
 * pricing misrepresentation that no test can see, so no literal dollar amount or
 * credit count appears in this file's prose. Prices come from `./prices.ts`, a
 * pure module both halves can import.
 */

// Not a cycle: `credits.ts` reaches back for `PlanId` with `import type`, which
// is erased — the only runtime edge is this one, plans → credits.
import { PERSONAL_MONTHLY_CREDITS, SEAT_MONTHLY_CREDITS } from "./credits";
import { formatMoney, MAX_PRICE, PRO_PRICE, TEAM_SEAT_PRICE } from "./prices";
import type { WorkspaceKind } from "@/features/workspaces/types";

/**
 * The billing taxonomy; each value is scoped to a container kind — `team` only
 * on a standard workspace, `pro` (2026-09-08) and `max` (2026-10-22) only on
 * `kind='home'`, `solo` retired and sold nowhere, `free` = no live
 * subscription on either.
 * Mirrored by `workspace_billing_plan_check`
 * (`20261121170000_workspace_billing_plan_max.sql`): a value here the CHECK
 * lacks is a `23514` inside the Stripe webhook, which retries forever.
 */
export type PlanId = "free" | "solo" | "team" | "pro" | "max";

/**
 * The personal (home-space) PAID plans, cheapest first. The one list every
 * "is this a personal paid plan" question reads, so a fourth personal tier is
 * an edit here rather than a hunt for `plan === "pro"` (2026-10-22).
 */
export const PERSONAL_PAID_PLANS = ["pro", "max"] as const;
export type PersonalPaidPlan = (typeof PERSONAL_PAID_PLANS)[number];

export function isPersonalPaidPlan(plan: unknown): plan is PersonalPaidPlan {
  return plan === "pro" || plan === "max";
}

/**
 * Rank of a personal paid plan — a higher number is the bigger tier. Decides
 * whether a switch is an UPGRADE (immediate, prorated) or a DOWNGRADE (at the
 * period end) in `server/plan-change.ts`.
 */
export function personalPlanRank(plan: PersonalPaidPlan): number {
  return PERSONAL_PAID_PLANS.indexOf(plan);
}

/**
 * Display name of the third tier. ⚠ A WORKING NAME (Samuel, 2026-10-22: "I
 * don't know what we should call it") — every surface reads this constant, so a
 * rename is this one line. The plan ID `max` is not a display string and does
 * not move with it.
 */
export const MAX_PLAN_NAME = "Max";

/** Display names of the personal plans, for copy that names "the plan in front
 *  of it" ("Welcome to …", "Upgrade to …"). */
export const PERSONAL_PLAN_NAMES: Record<"free" | PersonalPaidPlan, string> = {
  free: "Free",
  pro: "Pro",
  max: MAX_PLAN_NAME,
};

/**
 * Thousands separators for a number that renders in copy. Locale-pinned: a bare
 * `toLocaleString()` reads the runtime's locale — the server's during SSR, the
 * reader's in the browser — so `10,000` vs `10.000` would be a React hydration
 * mismatch on the pricing page.
 */
export function planNumber(value: number): string {
  return value.toLocaleString("en-US");
}

/**
 * Free-plan capacity. These live here rather than beside the gate because
 * `server/entitlements.ts` opens with `import "server-only"`, so no rendering
 * surface could read them and each restated the numbers as prose.
 * `entitlements.ts` re-exports them, so existing importers and `vi.mock`s are
 * unchanged and the gate still reads one definition.
 */

/** Ontology objects a multi-member free workspace may hold. 1-member free is
 *  uncapped, and the cap freezes creates only — never reads/edits/exports. */
export const FREE_MULTI_MEMBER_OBJECT_CAP = 100;

/** Days of chat history a free workspace can see. Hide, never delete. */
export const FREE_CHATS_WINDOW_DAYS = 90;

/**
 * Canonical workspace billing status. "free" = no live subscription; paid states
 * mirror Stripe. Single source so the union isn't hand-redeclared per module.
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
 * The seat credits line, worded once for both workspace cards. "per member" is
 * load-bearing: the allowance is per person, not a workspace pool (`credits.ts ›
 * SEAT_MONTHLY_CREDITS`), and dropping it beside "Unlimited members" would read
 * as a pool.
 */
const seatCreditsFeature = (plan: PlanId) =>
  `${planNumber(SEAT_MONTHLY_CREDITS[plan])} credits per member / month`;

/**
 * The personal credits line. Deliberately not "per member": a home space
 * has exactly one member, so the wording would imply a roster that cannot exist.
 */
const personalCreditsFeature = (tier: "free" | PersonalPaidPlan) =>
  `${planNumber(PERSONAL_MONTHLY_CREDITS[tier])} credits / month`;

/**
 * Standard-workspace plans — Starter and Team. Two cards since 2026-09-07, and
 * the length is a contract some surface renders; the retired Solo card is gone
 * and the id survives on `PlanId` for legacy rows only.
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
 * Home-space plans — Free, Pro (2026-09-08, spec §11.1) and Max (2026-10-22).
 * Three cards, cheapest first; the order is the upgrade ladder the plan cards
 * and `/pricing` render left to right.
 *
 * No member line and no seat wording on either card: a home space has
 * exactly one member (`20260920120000_workspace_kind_personal.sql`), so
 * "Unlimited members" would invite what the container refuses
 * (`server/entitlements.ts › assertCanAddMember`). The object cap is a
 * multi-member free rule and never applies here either.
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
  {
    id: "max",
    name: MAX_PLAN_NAME,
    priceMonthly: formatMoney(MAX_PRICE),
    priceNote: "/ month",
    features: [
      "Unlimited ontology objects",
      "Full chat history",
      personalCreditsFeature("max"),
      "Priority support",
    ],
  },
];

/**
 * The plans a container of this kind may be shown — the only correct way to
 * choose between the two groups.
 *
 * `link` falling to the workspace group is deliberate: an unknown kind must not
 * be offered a checkout that 400s, and `pro`/`max` are refused for anything
 * but `home`. An absent kind (a row read before `20260920120000` applied) is
 * `standard`, the same default `workspaces/types.ts › isStandardWorkspace` takes.
 */
export function plansForKind(
  kind: WorkspaceKind | undefined
): ReadonlyArray<PlanDef> {
  return kind === "home" ? PERSONAL_PLANS : WORKSPACE_PLANS;
}
