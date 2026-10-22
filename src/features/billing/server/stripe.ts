import "server-only";
import Stripe from "stripe";
import { STRIPE_SESSION_ID_TEMPLATE, billingUrl } from "../url";

/**
 * Where Stripe sends the browser back: `src/app/billing/[segment]/page.tsx`.
 * Sessions minted today are redeemed days later, so this URL must name a
 * surviving page.
 *
 * Pass the segment whenever the caller has one: bare `/billing` resolves the
 * caller's sole owned workspace or asks them to pick — either way, possibly not
 * the one the subscription just paid for.
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
 * Per-seat Team price. The env is still named STRIPE_PRO_SEAT_PRICE_ID — the live
 * price predates the Team rename. Null when unset so callers degrade (seat-sync
 * no-ops; checkout surfaces a config error).
 */
export function getSeatPriceId(): string | null {
  return process.env.STRIPE_PRO_SEAT_PRICE_ID || null;
}

/**
 * Flat Solo price — legacy-only since 2026-09-07 (A6). Nothing mints against it;
 * it stays because live `solo` subscriptions still bill on it and must be
 * recognized (`selectSeatItem`, `webhook-handler.ts › derivePlan`). May be unset
 * in dev/test — null so callers degrade like `getSeatPriceId`.
 */
export function getSoloPriceId(): string | null {
  return process.env.STRIPE_SOLO_PRICE_ID || null;
}

/**
 * Flat personal Pro price — $8.99/month on a `kind='home'` container
 * (2026-09-08). Not the retired Solo plan even though Stripe hangs it off the same
 * product: separate prices, `PlanId`s and container kinds. Null when unset so
 * callers degrade like `getSeatPriceId`.
 */
export function getPersonalProPriceId(): string | null {
  return process.env.STRIPE_PERSONAL_PRO_PRICE_ID || null;
}

/**
 * Flat personal Max price — $24.99/month on a `kind='home'` container
 * (2026-10-22). Null when unset, and every SELLING path fails closed on that
 * with an error naming `STRIPE_PERSONAL_MAX_PRICE_ID` — Max is never minted on
 * another line's price. Recognition (`derivePlan`) treats unset as
 * "inconclusive", exactly like the other price envs.
 */
export function getPersonalMaxPriceId(): string | null {
  return process.env.STRIPE_PERSONAL_MAX_PRICE_ID || null;
}

/**
 * Max prices that are no longer SOLD but still BILL (2026-10-22 review): a comma
 * list in `STRIPE_LEGACY_MAX_PRICE_IDS`, the Max twin of
 * `STRIPE_LEGACY_SEAT_PRICE_ID`. Repricing Max mints a new price; every live
 * subscription stays on the old one until it is migrated, and without this list
 * those paying subscribers would stop being recognised as Max. Unset is normal.
 */
export function getLegacyMaxPriceIds(): string[] {
  return (process.env.STRIPE_LEGACY_MAX_PRICE_IDS ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
}

/** The Stripe `lookup_key` a Max price carries in either mode. A price created
 *  with it is recognised as Max with no env edit at all — the rotation-proof
 *  arm. Recognition only; selling always uses `STRIPE_PERSONAL_MAX_PRICE_ID`. */
export const MAX_PRICE_LOOKUP_KEY = "dopl_personal_max";

/** Is this Stripe price a Max price — current, legacy, or lookup-keyed? */
export function isPersonalMaxPrice(
  price: { id?: string | null; lookup_key?: string | null } | null | undefined
): boolean {
  if (!price?.id) return false;
  if (price.lookup_key === MAX_PRICE_LOOKUP_KEY) return true;
  const current = getPersonalMaxPriceId();
  return price.id === current || getLegacyMaxPriceIds().includes(price.id);
}

/** The Stripe price a personal paid plan is sold on, or null when its env is
 *  unset in this environment. */
export function personalPlanPriceId(plan: "pro" | "max"): string | null {
  return plan === "max" ? getPersonalMaxPriceId() : getPersonalProPriceId();
}

/** The env var behind `personalPlanPriceId(plan)` — for the fail-closed error. */
export function personalPlanPriceEnv(plan: "pro" | "max"): string {
  return plan === "max"
    ? "STRIPE_PERSONAL_MAX_PRICE_ID"
    : "STRIPE_PERSONAL_PRO_PRICE_ID";
}

/**
 * The previous per-seat Team price ($7.99), recognition only and optional.
 * Nothing mints against it, but a subscription whose price this env does not name
 * falls through `selectSeatItem` to `items[0]` and out of `derivePlan`'s price arm
 * into the metadata fallback. Unset is normal outside production.
 */
export function getLegacySeatPriceId(): string | null {
  return process.env.STRIPE_LEGACY_SEAT_PRICE_ID || null;
}

/**
 * Pick the subscription item carrying the plan price. A subscription may hold
 * several items (add-ons, legacy prices), so `items.data[0]` can bill the wrong
 * line.
 *
 * The order is "what is sold today first, then what is still billed": a sub
 * carrying both a current and a legacy seat item is mid-migration and its live
 * line is the current one. The Solo arm is legacy-only (2026-09-07, A6) and stays
 * — deleting it would point `upgrade-to-team` and the seat sync at `items.data[0]`
 * on any Solo sub that ever grew a second item.
 */
export function selectSeatItem(
  subscription: Stripe.Subscription
): Stripe.SubscriptionItem | undefined {
  const items = subscription.items?.data ?? [];
  for (const priceId of [
    getSeatPriceId(),
    getLegacySeatPriceId(),
    getPersonalMaxPriceId(),
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
  /** The container being bought for — a standard workspace for `team`, the
   *  caller's `kind='home'` container for `pro`. Same column either way, which
   *  is why personal Pro needs no second Stripe pipeline. */
  workspaceId: string;
  /** `"team"`, `"pro"` (2026-09-08) or `"max"` (2026-10-22). The retired Solo
   *  plan cannot be minted:
   *  `POST /api/billing/checkout` answers 400 `PLAN_RETIRED`, and
   *  `PLAN_NOT_FOR_CONTAINER` when a plan meets the wrong container kind. This
   *  narrowing is the second lock. */
  plan: "team" | "pro" | "max";
  /** Team seat quantity (= active member count). Ignored for `pro` and `max`,
   *  which are flat at quantity 1. */
  quantity: number;
  email: string;
  stripeCustomerId?: string | null;
  /** Canonical `{slug}-{publicId}` segment of the workspace being bought for —
   *  without it the return lands on the picker, not on the purchase. */
  segment?: string | null;
}

/**
 * Container-scoped subscription checkout: `team` buys `STRIPE_PRO_SEAT_PRICE_ID`
 * at `max(1, quantity)` seats (env name predates the Team rename), `pro` buys
 * `STRIPE_PERSONAL_PRO_PRICE_ID` and `max` `STRIPE_PERSONAL_MAX_PRICE_ID`, both
 * at quantity 1.
 *
 * Stamps `{ workspace_id, plan }` into both session and subscription metadata so
 * the webhook can route the subscription back and derive the plan even where the
 * price envs are unset.
 *
 * An unset price throws, naming its own env var, and never falls back to the other
 * line: that would put a subscription on the wrong container kind, which
 * `webhook-plan.ts` can only report after the money has moved.
 *
 * `ui_mode: "elements"` — our own PaymentElement form, not a Stripe iframe.
 * Elements mode disallows `custom_text` / `branding_settings`, and
 * `redirect_on_completion` is embedded-only.
 */
export async function createWorkspaceCheckoutSession(
  args: WorkspaceCheckoutArgs
): Promise<string> {
  const stripe = getStripe();

  const personal = args.plan === "team" ? null : args.plan;
  const priceId = personal ? personalPlanPriceId(personal) : getSeatPriceId();
  if (!priceId) {
    throw new Error(
      personal
        ? `Personal ${personal} price not configured. Set ${personalPlanPriceEnv(personal)} in env.`
        : "Per-seat Team price not configured. Set STRIPE_PRO_SEAT_PRICE_ID in env."
    );
  }

  const quantity = personal ? 1 : Math.max(1, args.quantity);
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

  // 🔒 A NAMED PORTAL CONFIGURATION WHEN ONE IS SET (2026-10-22 review): the
  // account-default portal can be set to allow plan switching, which would move
  // a subscription between tiers with none of `plan-change.ts`'s rules (no
  // period-end downgrade, no claim, no confirm). `STRIPE_PORTAL_CONFIGURATION_ID`
  // names a configuration with subscription UPDATES disabled; unset keeps the
  // account default, as before.
  const configuration = process.env.STRIPE_PORTAL_CONFIGURATION_ID || undefined;
  const session = await stripe.billingPortal.sessions.create({
    customer: stripeCustomerId,
    return_url: returnUrl(segment, "return"),
    ...(configuration ? { configuration } : {}),
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

/**
 * The subscription as Stripe holds it NOW, for a webhook that would otherwise
 * trust its event's snapshot (2026-10-22 review). Two of our own writes can land
 * in one second — release a schedule, then swap the price — and the event
 * watermark compares whole seconds, so the second event's snapshot could be
 * dropped as stale while the first one's (older) snapshot stands: the payer on
 * Max, the row on Pro. Writing what Stripe says at processing time makes the
 * order of same-second events irrelevant.
 *
 * `refetched: false` = the snapshot is used: Stripe is not configured here (tests,
 * preview), or the subscription no longer exists (`resource_missing`), in which
 * case the snapshot is the last word there is. Any OTHER failure THROWS — the
 * webhook answers 500 and Stripe retries, rather than writing a guess.
 */
export async function retrieveFreshSubscription(
  snapshot: Stripe.Subscription
): Promise<{ subscription: Stripe.Subscription; refetched: boolean }> {
  if (!isStripeConfigured()) return { subscription: snapshot, refetched: false };
  try {
    return {
      subscription: await getStripe().subscriptions.retrieve(snapshot.id),
      refetched: true,
    };
  } catch (err) {
    const code = (err as { code?: string } | null)?.code;
    if (code === "resource_missing") return { subscription: snapshot, refetched: false };
    throw err;
  }
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
