/**
 * THE STRIPE ACCOUNT SURFACE — the shapes that cross the wire, and nothing else.
 *
 * Pure and framework-free ON PURPOSE, exactly like `./credits.ts`: the server
 * service (`server/billing-account-service.ts`) builds these, the three routes
 * return them, and the client hooks (`components/use-billing-account.ts`) read
 * them. It may not import `server-only`, Supabase, Stripe or React.
 *
 * WHY THESE THREE THINGS ARE ONE MODULE. Payment method, invoices and the
 * cancel switch are the same fact from three angles — the workspace's Stripe
 * CUSTOMER — and all three are gated identically (admin, and only meaningful
 * once a workspace has paid at least once). Before this, every one of them was
 * a redirect into the Stripe-hosted portal.
 *
 * MINOR UNITS, ALWAYS. Stripe reports money in the currency's smallest unit
 * (`amountPaid: 599` is $5.99). Nothing in this module divides by 100 on its
 * own — `formatInvoiceAmount` is the ONE place that conversion happens, so a
 * zero-decimal currency (JPY) cannot be mis-rendered by a second copy.
 */

/** The card (or other default method) Stripe will charge next. */
export interface PaymentMethodDto {
  /** "visa" / "mastercard" / … — Stripe's own brand slug, lowercased. */
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
}

/** Stripe's invoice statuses, verbatim. `null` is a Stripe possibility. */
export type InvoiceStatus =
  | "draft"
  | "open"
  | "paid"
  | "uncollectible"
  | "void";

export interface InvoiceDto {
  id: string;
  /** Human-facing invoice number ("DOPL-0001"); null on a draft. */
  number: string | null;
  /** ISO-8601 instant — converted from Stripe's epoch seconds at the DTO
   *  boundary so no client re-implements the ×1000. */
  created: string;
  amountPaid: number;
  amountDue: number;
  /** Lowercase ISO-4217, as Stripe returns it ("usd"). */
  currency: string;
  status: InvoiceStatus | null;
  /** Stripe-hosted invoice page. Null when Stripe minted none (drafts). */
  hostedInvoiceUrl: string | null;
}

/** What `POST /api/billing/cancel` answers with — the state AFTER the write. */
export interface CancelPlanResult {
  /** Live now, will not renew. */
  cancelAtPeriodEnd: boolean;
  /** When access actually ends (or renews, after a resume). Null when the
   *  workspace's period end was never stamped by the webhook. */
  currentPeriodEnd: string | null;
}

/**
 * How many invoices the list route asks Stripe for. Two years of monthly
 * invoices — enough that the table is a history rather than a teaser, small
 * enough to stay one Stripe page (no cursor, no pagination UI).
 */
export const INVOICE_PAGE_SIZE = 24;

/** `$5.99` / `¥600` — a Stripe minor-unit amount in its own currency. */
export function formatInvoiceAmount(
  amountMinor: number,
  currency: string
): string {
  const code = (currency || "usd").toUpperCase();
  try {
    const format = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: code,
    });
    // `minimumFractionDigits` tells us what the currency's minor unit is
    // worth: 2 for USD (cents), 0 for JPY (no subunit at all).
    const digits = format.resolvedOptions().minimumFractionDigits ?? 2;
    return format.format(amountMinor / 10 ** digits);
  } catch {
    // An unknown currency code throws in `Intl`. Degrade to the raw major
    // amount rather than losing the row.
    return `${(amountMinor / 100).toFixed(2)} ${code}`;
  }
}

/** "Visa •••• 4242" — the one card label, used by page and pane alike. */
export function formatCardLabel(method: PaymentMethodDto): string {
  const brand = method.brand
    ? method.brand.charAt(0).toUpperCase() + method.brand.slice(1)
    : "Card";
  return `${brand} •••• ${method.last4}`;
}

/** "04 / 2029" — a card expiry, zero-padded month. */
export function formatCardExpiry(method: PaymentMethodDto): string {
  return `${String(method.expMonth).padStart(2, "0")} / ${method.expYear}`;
}
