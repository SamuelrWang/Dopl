import type { PlanId } from "./plans";

/**
 * The billing surface's URL — one builder, every caller: Stripe
 * checkout/portal `return_url`s, 402/403 `upgrade_url` envelopes, desktop
 * open-in-browser handoffs and /pricing, never hand-written. All resolve to
 * `/billing/[segment]` (`src/app/billing/[segment]/page.tsx`).
 *
 * Must stay pure — no `next/*`, no `server-only`, no browser globals: the
 * desktop SPA, the `server-only` Stripe modules and RSC pages all import it.
 */

/**
 * The plans a checkout may be opened for — team and pro (2026-09-08, spec §11).
 * This type only says which plans have a price at all; which container may buy
 * one is fenced by `POST /api/billing/checkout` (400 `PLAN_NOT_FOR_CONTAINER`).
 * Retired `solo` is deliberately absent (2026-09-07, spec A6) and is a
 * different thing from `pro` despite the label it once wore in the UI.
 *
 * Spelled as an explicit literal rather than `Exclude<PlanId, "free">` because
 * subtraction widens: adding `"enterprise"` to `PlanId` would have made it
 * checkout-able with no edit here and no type error. `PlanIdSubset`'s
 * constraint costs nothing at runtime and breaks the build if `team` or `pro`
 * is renamed or retired in the taxonomy.
 */
type PlanIdSubset<T extends PlanId> = T;
export type CheckoutPlan = PlanIdSubset<"team" | "pro">;

/**
 * `?billing=` param. Values are verbatim-frozen — Stripe sessions and 402
 * envelopes carrying them are already in the wild.
 *   • `upgrade` — sell; pair with `plan` to land straight in checkout.
 *   • `success` — checkout return, and the poll trigger: `plans-billing-core`
 *     only runs its 20×1s subscription poll on a non-null `billingReturn`, so
 *     dropping this param shows a stale Starter plan to someone who just paid.
 *   • `return`  — Stripe portal return (cancel / downgrade); polls quietly.
 */
export type BillingIntent = "upgrade" | "success" | "return";

/** Segment-less `/billing` is legal — with `?plan=pro` it forwards to the
 *  caller's home space, otherwise it forwards when they own exactly one
 *  standard workspace and asks them to pick when they do not
 *  (`src/app/billing/page.tsx`). */
export const BILLING_SURFACE_ROOT = "/billing";

/**
 * Must reach Stripe unencoded — `%7BCHECKOUT_SESSION_ID%7D` is delivered as-is,
 * never substituted. Hence `billingPath` concatenates the query instead of
 * using `URLSearchParams`.
 */
export const STRIPE_SESSION_ID_TEMPLATE = "{CHECKOUT_SESSION_ID}";

export interface BillingPathOptions {
  /** Canonical `{slug}-{publicId}` segment. Omit only with no workspace in
   *  hand — bare `/billing` resolves one or asks. */
  segment?: string | null;
  intent?: BillingIntent;
  /** Opens checkout on arrival instead of re-asking. */
  plan?: CheckoutPlan | null;
  /** A real session id, or `STRIPE_SESSION_ID_TEMPLATE` for a `return_url`. */
  sessionId?: string | null;
}

/** `/billing/acme-ab12cd34ef56?billing=upgrade&plan=team` — path only.
 *  `plan=pro` with no segment is the home-space forward: the seller
 *  rarely holds that segment, and `/billing` resolves it (`page.tsx`). */
export function billingPath({
  segment,
  intent,
  plan,
  sessionId,
}: BillingPathOptions = {}): string {
  const base = segment
    ? `${BILLING_SURFACE_ROOT}/${encodeURIComponent(segment)}`
    : BILLING_SURFACE_ROOT;
  const query: string[] = [];
  if (intent) query.push(`billing=${intent}`);
  if (plan) query.push(`plan=${plan}`);
  if (sessionId) query.push(`session_id=${sessionId}`);
  return query.length > 0 ? `${base}?${query.join("&")}` : base;
}

/** Absolute form — Stripe `return_url`s, `upgrade_url` envelopes followed
 *  literally, and the desktop renderer (`file://`, `location.origin` lies). */
export function billingUrl(
  origin: string,
  options: BillingPathOptions = {}
): string {
  return `${origin.replace(/\/+$/, "")}${billingPath(options)}`;
}

/**
 * Rebuild this page's own URL from resolved `searchParams`, query intact: the
 * signed-out bounce's `?redirectTo=` must carry it or a first-time payer's
 * `?billing=upgrade` is lost across sign-in. Also the canonical-segment redirect.
 */
export function billingSelfPath(
  segment: string | null | undefined,
  searchParams: Record<string, string | string[] | undefined> = {}
): string {
  const base = segment
    ? `${BILLING_SURFACE_ROOT}/${encodeURIComponent(segment)}`
    : BILLING_SURFACE_ROOT;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (typeof value === "string") query.set(key, value);
  }
  const qs = query.toString();
  return qs ? `${base}?${qs}` : base;
}

/** `billingReturn` signal `plans-billing-core` polls on. `upgrade` is not one
 *  — nothing bought yet. */
export function parseBillingReturn(
  raw: string | null | undefined
): "success" | "return" | null {
  return raw === "success" || raw === "return" ? raw : null;
}

export function parseBillingIntent(
  raw: string | null | undefined
): BillingIntent | null {
  return raw === "upgrade" || raw === "success" || raw === "return" ? raw : null;
}

/**
 * `?plan=` → a checkout to open on arrival. `team` and `pro` are the only
 * accepted values (`pro` added 2026-09-08): a stale `?plan=solo` link parses to
 * `null`, so the payer lands on the plan list rather than in a checkout for a
 * price no longer sold.
 *
 * It does not check the container and cannot — a URL is parsed before any
 * workspace is resolved. `plan=pro` on a standard workspace's billing page is a
 * well-formed request the checkout route refuses (400 `PLAN_NOT_FOR_CONTAINER`).
 */
export function parseCheckoutPlan(
  raw: string | null | undefined
): CheckoutPlan | null {
  return raw === "team" || raw === "pro" ? raw : null;
}
