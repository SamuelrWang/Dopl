import type { PlanId } from "./plans";

/**
 * THE billing surface's URL — one builder, every caller. Stripe
 * checkout/portal `return_url`s, 402/403 `upgrade_url` envelopes, desktop
 * open-in-browser handoffs and /pricing all resolve here, never hand-written.
 *
 * All resolve to `/billing/[segment]` (`src/app/billing/[segment]/page.tsx`),
 * which imports none of the app shell.
 *
 * ⚠ Must stay pure — no `next/*`, no `server-only`, no browser globals: the
 * desktop SPA, the `server-only` Stripe modules and RSC pages all import it.
 */

/** Derived from the taxonomy so a fourth plan cannot silently become
 *  checkout-able. */
export type CheckoutPlan = Exclude<PlanId, "free">;

/**
 * `?billing=` param. ⚠ Values are verbatim-frozen — Stripe sessions and 402
 * envelopes carrying them are already in the wild.
 *   • `upgrade` — sell (402 envelopes, desktop Upgrade). Pair with `plan` to
 *     land straight in checkout.
 *   • `success` — checkout return. THE POLL TRIGGER: `plans-billing-core` only
 *     runs its 20×1s subscription poll on a non-null `billingReturn`, so
 *     dropping this param shows a stale Starter plan to someone who just paid.
 *   • `return`  — Stripe portal return (cancel / downgrade); polls quietly.
 */
export type BillingIntent = "upgrade" | "success" | "return";

/** Segment-less `/billing` is legal — it forwards when the caller owns exactly
 *  one standard workspace and otherwise asks them to pick
 *  (`src/app/billing/page.tsx`). */
export const BILLING_SURFACE_ROOT = "/billing";

/**
 * ⚠ MUST reach Stripe unencoded — `%7BCHECKOUT_SESSION_ID%7D` is delivered
 * as-is, never substituted. Hence `billingPath` concatenates the query instead
 * of using `URLSearchParams`.
 */
export const STRIPE_SESSION_ID_TEMPLATE = "{CHECKOUT_SESSION_ID}";

export interface BillingPathOptions {
  /** Canonical `{slug}-{publicId}` segment. ⚠ Omit ONLY with no workspace in
   *  hand — bare `/billing` resolves one or asks. */
  segment?: string | null;
  intent?: BillingIntent;
  /** Opens checkout on arrival instead of re-asking. */
  plan?: CheckoutPlan | null;
  /** A real session id, or `STRIPE_SESSION_ID_TEMPLATE` for a `return_url`. */
  sessionId?: string | null;
}

/** `/billing/acme-ab12cd34ef56?billing=upgrade&plan=solo` — path only. */
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
 * Rebuild this page's own URL from resolved `searchParams`, QUERY INTACT — ⚠ the
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

/** `billingReturn` signal `plans-billing-core` polls on. `upgrade` is NOT one
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

export function parseCheckoutPlan(
  raw: string | null | undefined
): CheckoutPlan | null {
  return raw === "solo" || raw === "team" ? raw : null;
}
