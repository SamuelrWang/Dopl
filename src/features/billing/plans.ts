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
import { formatMoney, PRO_PRICE, TEAM_SEAT_PRICE } from "./prices";
import type { WorkspaceKind } from "@/features/workspaces/types";

/**
 * The billing taxonomy; each value is scoped to a container kind — `team` only
 * on a standard workspace, `pro` (2026-09-08) only on `kind='home'`, `solo`
 * retired and sold nowhere, `free` = no live subscription on either.
 * Mirrored by `workspace_billing_plan_check`
 * (`20260930130000_workspace_billing_plan_pro.sql`): a value here the CHECK
 * lacks is a `23514` inside the Stripe webhook, which retries forever.
 */
export type PlanId = "free" | "solo" | "team" | "pro";

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
const personalCreditsFeature = (tier: "free" | "pro") =>
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
 * Home-space plans — Free and Pro (2026-09-08, spec §11.1).
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
];

/**
 * The plans a container of this kind may be shown — the only correct way to
 * choose between the two groups.
 *
 * `link` falling to the workspace group is deliberate: an unknown kind must not
 * be offered a checkout that 400s, and `pro` is refused for anything but
 * `home`. An absent kind (a row read before `20260920120000` applied) is
 * `standard`, the same default `workspaces/types.ts › isStandardWorkspace` takes.
 */
export function plansForKind(
  kind: WorkspaceKind | undefined
): ReadonlyArray<PlanDef> {
  return kind === "home" ? PERSONAL_PLANS : WORKSPACE_PLANS;
}
