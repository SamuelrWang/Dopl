import "server-only";
import Stripe from "stripe";
import { STRIPE_SESSION_ID_TEMPLATE, billingUrl } from "../url";

/**
 * ⚠ Where Stripe sends the browser back: `src/app/billing/[segment]/page.tsx`,
 * NOT `/{segment}/canvas?billing=…` (RETIRE list,
 * docs/migration-research/website-retirement-plan.md §2.3). Sessions minted
 * today are redeemed days later, so this URL must name a surviving page.
 *
 * ⚠ Pass the segment whenever the caller has one (`withWorkspaceAuth` hands
 * every billing route a `workspaceSlug` + `workspacePublicId`). Without it,
 * bare `/billing` resolves the caller's SOLE owned workspace or asks them to
 * pick — either way, possibly not the one the subscription just paid for.
 */
function returnUrl(
  segment: string | null | undefined,
  intent: "success" | "return",
  sessionId?: string
): string {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://www.usedopl.com";
  return billingUrl(appUrl, { segment, intent, sessionId });
}

let _stripe: Stripe | null = null;

export function getStripe(): Stripe {
  if (!_stripe) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error("STRIPE_SECRET_KEY is required");
    _stripe = new Stripe(key);
  }
  return _stripe;
}

/** Lets seat-sync / checkout no-op cleanly in test + preview without a key. */
export function isStripeConfigured(): boolean {
  return !!process.env.STRIPE_SECRET_KEY;
}

/**
 * Per-seat Team price. ⚠ Env is still named STRIPE_PRO_SEAT_PRICE_ID — the live
 * price predates the Team rename. Null when unset so callers degrade
 * (seat-sync no-ops; checkout surfaces a config error).
 */
export function getSeatPriceId(): string | null {
  return process.env.STRIPE_PRO_SEAT_PRICE_ID || null;
}

/**
 * Flat Solo price. ⚠ LEGACY-ONLY since 2026-09-07 (spec A6): Solo/"Pro" is
 * retired from sale, so nothing MINTS against this price any more — it stays
 * because live `solo` subscriptions still bill against it and must still be
 * recognized (`selectSeatItem`, `webhook-handler.ts › derivePlan`). May be
 * UNSET in dev/test — null so callers degrade like `getSeatPriceId`.
 */
export function getSoloPriceId(): string | null {
  return process.env.STRIPE_SOLO_PRICE_ID || null;
}

/**
 * Flat PERSONAL PRO price — $8.99/month on a `kind='personal'` container
 * (2026-09-08, spec §11). ⚠ NOT the retired Solo plan even though Stripe hangs
 * it off the same PRODUCT: Solo was a flat plan for a whole standard workspace,
 * Pro is one person's home space. The two are separate prices, separate
 * `PlanId`s and separate container kinds, and only `getSoloPriceId` is legacy.
 * Null when unset so callers degrade like `getSeatPriceId`.
 */
export function getPersonalProPriceId(): string | null {
  return process.env.STRIPE_PERSONAL_PRO_PRICE_ID || null;
}

/**
 * The PREVIOUS per-seat Team price ($7.99), RECOGNITION ONLY and OPTIONAL.
 *
 * ⚠ Nothing mints against it — `getSeatPriceId` is the price a new Team
 * checkout buys. It exists because live subscriptions still bill on it
 * (measured 2026-09-08: one), and a subscription whose price this env does not
 * name falls through `selectSeatItem` to `items[0]` and out of `derivePlan`'s
 * price arm into the metadata fallback. ⚠ UNSET IS NORMAL — dev, preview and
 * any environment created after the flip have no legacy sub to recognize.
 */
export function getLegacySeatPriceId(): string | null {
  return process.env.STRIPE_LEGACY_SEAT_PRICE_ID || null;
}

/**
 * Pick the subscription item carrying the plan price. ⚠ A subscription may hold
 * several items (add-ons, legacy prices), so `items.data[0]` can bill the wrong
 * line. Order: current per-seat Team price → LEGACY seat price → personal Pro →
 * flat Solo → the first item (legacy single-item $20 subs).
 *
 * ⚠ THE ORDER IS "WHAT IS SOLD TODAY FIRST, THEN WHAT IS STILL BILLED", and the
 * three trailing arms are all recognition-only: a sub carrying BOTH a current
 * and a legacy seat item is mid-migration and its live line is the current one,
 * and no sub can carry both a Pro and a seat price (they live on different
 * container kinds — `checkout/route.ts` is that fence).
 *
 * ⚠ THE SOLO ARM STAYS AND IS LEGACY-ONLY (2026-09-07, spec A6). Solo is off
 * sale, not off the books: the live rows are exactly what this arm is for, and
 * deleting it would send `upgrade-to-team` and the seat sync at `items.data[0]`
 * — the wrong line on any Solo sub that ever grew a second item.
 */
export function selectSeatItem(
  subscription: Stripe.Subscription
): Stripe.SubscriptionItem | undefined {
  const items = subscription.items?.data ?? [];
  for (const priceId of [
    getSeatPriceId(),
    getLegacySeatPriceId(),
    getPersonalProPriceId(),
    getSoloPriceId(),
  ]) {
    if (!priceId) continue;
    const match = items.find((item) => item.price?.id === priceId);
    if (match) return match;
  }
  return items[0];
}

export interface WorkspaceCheckoutArgs {
  /** ⚠ The CONTAINER being bought for — a standard workspace for `team`, the
   *  caller's `kind='personal'` container for `pro`. Same column either way
   *  (`workspace_billing.workspace_id`), which is why a personal Pro
   *  subscription needs no second Stripe pipeline (spec §11.1). */
  workspaceId: string;
  /** ⚠ `"team"` or `"pro"` (2026-09-08, spec §11) — Solo/"Pro", the retired
   *  $5.99 flat WORKSPACE plan, is not either of them and cannot be minted at
   *  all. `POST /api/billing/checkout` answers 400 `PLAN_RETIRED` for it and
   *  400 `PLAN_NOT_FOR_CONTAINER` when a plan meets the wrong container kind;
   *  this narrowing is the second lock. */
  plan: "team" | "pro";
  /** Team seat quantity (= active member count). ⚠ IGNORED for `pro`, which is
   *  flat: one personal container, one person, quantity 1. */
  quantity: number;
  email: string;
  stripeCustomerId?: string | null;
  /** ⚠ Canonical `{slug}-{publicId}` segment of the workspace being bought
   *  for — without it the return lands on the picker, not on the purchase. */
  segment?: string | null;
}

/**
 * Container-scoped subscription checkout, one of two lines:
 *   • `team` → `STRIPE_PRO_SEAT_PRICE_ID` at `max(1, quantity)` seats. ⚠ Env
 *     name predates the Team rename.
 *   • `pro`  → `STRIPE_PERSONAL_PRO_PRICE_ID` at quantity 1 (flat; a personal
 *     container has exactly one member by construction).
 * The retired Solo branch is GONE (off sale, 2026-09-07) and `pro` is NOT its
 * replacement — it is a different plan on a different container kind.
 *
 * ⚠ Stamps `{ workspace_id, plan }` into BOTH session and subscription metadata
 * so the webhook can route the subscription back and derive the plan even where
 * the price envs are unset.
 *
 * ⚠ AN UNSET PRICE THROWS, NAMING ITS OWN ENV VAR, and never falls back to the
 * other line: selling a $8.99 seat plan to somebody who asked for a $8.99
 * personal plan puts a subscription on the wrong container kind, which is the
 * one thing `webhook-plan.ts` can only report after the money has moved.
 *
 * `ui_mode: "elements"` — our own PaymentElement form, not a Stripe iframe.
 * ⚠ Elements mode disallows `custom_text` / `branding_settings`, and
 * `redirect_on_completion` is embedded-only.
 */
export async function createWorkspaceCheckoutSession(
  args: WorkspaceCheckoutArgs
): Promise<string> {
  const stripe = getStripe();

  const priceId =
    args.plan === "pro" ? getPersonalProPriceId() : getSeatPriceId();
  if (!priceId) {
    throw new Error(
      args.plan === "pro"
        ? "Personal Pro price not configured. Set STRIPE_PERSONAL_PRO_PRICE_ID in env."
        : "Per-seat Team price not configured. Set STRIPE_PRO_SEAT_PRICE_ID in env."
    );
  }

  const quantity = args.plan === "pro" ? 1 : Math.max(1, args.quantity);
  const metadata = { workspace_id: args.workspaceId, plan: args.plan };
  const sessionParams: Stripe.Checkout.SessionCreateParams = {
    ui_mode: "elements",
    mode: "subscription",
    line_items: [{ price: priceId, quantity }],
    return_url: returnUrl(args.segment, "success", STRIPE_SESSION_ID_TEMPLATE),
    metadata,
    subscription_data: {
      metadata,
    },
  };

  if (args.stripeCustomerId) {
    sessionParams.customer = args.stripeCustomerId;
  } else {
    sessionParams.customer_email = args.email;
  }

  // Collapses rapid double-clicks into one session: key stable within an hour
  // per workspace+plan+quantity. A retry next hour, a different plan, or a
  // seat count that changed mid-hour gets a fresh session.
  const hourBucket = new Date().toISOString().slice(0, 13);
  const session = await stripe.checkout.sessions.create(sessionParams, {
    idempotencyKey: `checkout:${args.workspaceId}:${args.plan}:${quantity}:${hourBucket}`,
  });
  return session.client_secret!;
}

export async function createPortalSession(
  stripeCustomerId: string,
  segment?: string | null
): Promise<string> {
  const stripe = getStripe();

  const session = await stripe.billingPortal.sessions.create({
    customer: stripeCustomerId,
    return_url: returnUrl(segment, "return"),
  });

  return session.url;
}

/**
 * Customer's DEFAULT payment method. Two sources in Stripe's order of
 * authority: `invoice_settings.default_payment_method` (what the portal edits),
 * then the newest attached card — a card with no default set is the normal
 * state after an embedded checkout. Null for a deleted/cardless customer.
 */
export async function getDefaultPaymentMethod(
  stripeCustomerId: string
): Promise<Stripe.PaymentMethod | null> {
  const stripe = getStripe();
  const customer = await stripe.customers.retrieve(stripeCustomerId, {
    expand: ["invoice_settings.default_payment_method"],
  });
  if (!customer.deleted) {
    const preferred = customer.invoice_settings?.default_payment_method;
    // Expanded → object (carries the card); unexpanded/absent → string id or
    // null. The expand above is what makes it an object.
    if (preferred && typeof preferred !== "string") return preferred;
  }
  const cards = await stripe.paymentMethods.list({
    customer: stripeCustomerId,
    type: "card",
    limit: 1,
  });
  return cards.data[0] ?? null;
}

/** Most recent invoices, newest first (Stripe's own order). */
export async function listCustomerInvoices(
  stripeCustomerId: string,
  limit: number
): Promise<Stripe.Invoice[]> {
  const stripe = getStripe();
  const invoices = await stripe.invoices.list({
    customer: stripeCustomerId,
    limit,
  });
  return invoices.data;
}

/**
 * Set (or clear) Stripe's `cancel_at_period_end`. Clearing is the RESUME path:
 * the sub was never canceled, only flagged not to renew, so no new checkout.
 */
export async function setSubscriptionCancelAtPeriodEnd(
  stripeSubscriptionId: string,
  cancelAtPeriodEnd: boolean
): Promise<Stripe.Subscription> {
  const stripe = getStripe();
  return stripe.subscriptions.update(stripeSubscriptionId, {
    cancel_at_period_end: cancelAtPeriodEnd,
  });
}

export function constructWebhookEvent(
  body: string,
  signature: string
): Stripe.Event {
  const stripe = getStripe();
  return stripe.webhooks.constructEvent(
    body,
    signature,
    process.env.STRIPE_WEBHOOK_SECRET!
  );
}
