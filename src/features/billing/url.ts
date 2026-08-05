import type { PlanId } from "./plans";

/**
 * THE billing surface's URL — one builder, every caller.
 *
 * WHY THIS MODULE EXISTS. Until the website retirement (docs/migration-research/
 * website-retirement-plan.md, decision D1) every money flow pointed at
 * `/{segment}/canvas?billing=…`: Stripe's checkout and portal `return_url`s, the
 * 402/403 `upgrade_url` envelopes, the desktop app's two open-in-browser
 * handoffs, and the public pricing page. That page is on the RETIRE list — the
 * whole `src/app/[workspaceSlug]` tree goes — so six independently hand-written
 * URLs would all have died at the same moment, in the one flow where a dead link
 * costs revenue rather than a 404.
 *
 * They now all come from here, and they all resolve to `/billing/[segment]`
 * (`src/app/billing/[segment]/page.tsx`) — a KEEP page that imports none of the
 * app shell. Checkout stays `ui_mode: "elements"`, i.e. our own React payment
 * form, which is exactly why the surface has to be a web page at all and cannot
 * move into the desktop app's `file://` renderer.
 *
 * PURE ON PURPOSE — no `next/*`, no `server-only`, no browser globals. The
 * desktop SPA imports it over the `@/` alias, the Stripe server modules import
 * it under `server-only`, and the Next pages import it in an RSC.
 */

/** The two paid plans checkout can sell. Derived from the canonical taxonomy
 *  so a fourth plan cannot silently become checkout-able. */
export type CheckoutPlan = Exclude<PlanId, "free">;

/**
 * What a visit to the billing page is FOR — the `?billing=` param, whose three
 * values predate this module (they were the app shell's settings-modal trigger)
 * and are preserved verbatim because Stripe sessions and 402 envelopes carrying
 * them are already in the wild:
 *   • `upgrade` — "sell me something" (the 402 envelopes, the desktop's Upgrade
 *     button). Pair with `plan` to land the visitor directly in checkout.
 *   • `success` — the checkout return. THE POLL TRIGGER: `plans-billing-core`
 *     only runs its 20×1s subscription poll when it is handed a non-null
 *     `billingReturn`, so a page that drops this param shows a stale Starter
 *     plan to somebody who just paid.
 *   • `return`  — the Stripe portal return (cancel / downgrade); polls quietly.
 */
export type BillingIntent = "upgrade" | "success" | "return";

/** The billing surface's root. `/billing` with no segment is legal and resolves
 *  the caller's DEFAULT workspace (`src/app/billing/page.tsx`) — the landing for
 *  the builders that have no workspace in hand (the 402 envelopes, /pricing). */
export const BILLING_SURFACE_ROOT = "/billing";

/**
 * Stripe's literal placeholder for the completed session id. It MUST reach
 * Stripe unencoded — a `%7BCHECKOUT_SESSION_ID%7D` is not substituted, it is
 * delivered as-is to the browser — which is why `billingPath` concatenates the
 * query instead of running it through `URLSearchParams`.
 */
export const STRIPE_SESSION_ID_TEMPLATE = "{CHECKOUT_SESSION_ID}";

export interface BillingPathOptions {
  /** The canonical `{slug}-{publicId}` workspace segment. Omit only when the
   *  caller genuinely has no workspace — a bare `/billing` bills whatever the
   *  DEFAULT workspace turns out to be, which is a worse answer than a segment. */
  segment?: string | null;
  intent?: BillingIntent;
  /** Names the plan so the page can open checkout on arrival instead of asking
   *  a question the caller already answered. */
  plan?: CheckoutPlan | null;
  /** A real session id, or `STRIPE_SESSION_ID_TEMPLATE` for a `return_url`. */
  sessionId?: string | null;
}

/** `/billing/acme-ab12cd34ef56?billing=upgrade&plan=solo` — the path only. */
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

/** The same path against an absolute origin — for Stripe `return_url`s, the
 *  `upgrade_url` envelopes API-first clients follow literally, and the desktop
 *  renderer (a `file://` document, so `window.location.origin` is a lie). */
export function billingUrl(
  origin: string,
  options: BillingPathOptions = {}
): string {
  return `${origin.replace(/\/+$/, "")}${billingPath(options)}`;
}

/**
 * Rebuild this page's own URL from a resolved Next `searchParams` bag, query
 * intact. Used for the signed-out login bounce (`?redirectTo=` has to carry the
 * query or a first-time payer's `?billing=upgrade` is lost across the sign-in)
 * and for the canonical-segment redirect.
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

/** The `billingReturn` signal `plans-billing-core` polls on — `upgrade` is not
 *  one (nothing has been bought yet, so there is nothing to wait for). */
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
