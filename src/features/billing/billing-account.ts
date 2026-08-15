/**
 * Stripe account wire shapes.
 *
 * ⚠ Must stay pure/framework-free like `./credits.ts` — server service, routes
 * and client hooks all import it: no `server-only`, Supabase, Stripe, React.
 *
 * MINOR UNITS ALWAYS (`amountPaid: 599` = $5.99). `formatInvoiceAmount` is the
 * ONE converter, so zero-decimal currencies (JPY) can't be mis-rendered.
 */

/** Default method Stripe will charge next. */
export interface PaymentMethodDto {
  /** Stripe brand slug, lowercased ("visa"). */
  brand: string;
  last4: string;
  /** NULL when Stripe reported none, never `0` — expiry-less cards are legal
   *  (wallet-backed) and `0` renders "00 / 0". Null = pane drops the line. */
  expMonth: number | null;
  expYear: number | null;
}

/** Stripe's invoice statuses verbatim. `null` is a Stripe possibility. */
export type InvoiceStatus =
  | "draft"
  | "open"
  | "paid"
  | "uncollectible"
  | "void";

/**
 * Runtime half of `InvoiceStatus`. ⚠ Stripe can add a status in a live payload
 * with no deploy here, arriving typed as `InvoiceStatus` — narrow with
 * `isInvoiceStatus` so unknowns render neutral instead of missing a `Record`.
 */
export const INVOICE_STATUSES: readonly InvoiceStatus[] = [
  "draft",
  "open",
  "paid",
  "uncollectible",
  "void",
];

/** Narrows wire string to a status we have styling for. */
export function isInvoiceStatus(
  value: string | null | undefined
): value is InvoiceStatus {
  return value != null && (INVOICE_STATUSES as readonly string[]).includes(value);
}

export interface InvoiceDto {
  id: string;
  /** Null on a draft. */
  number: string | null;
  /** ISO-8601 — Stripe epoch seconds converted at the DTO boundary so no client
   *  re-implements the ×1000. */
  created: string;
  amountPaid: number;
  amountDue: number;
  /** Lowercase ISO-4217, as Stripe returns it ("usd"). */
  currency: string;
  status: InvoiceStatus | null;
  /** Null when Stripe minted none (drafts). */
  hostedInvoiceUrl: string | null;
}

/** `POST /api/billing/cancel` reply — state AFTER the write. */
export interface CancelPlanResult {
  /** Live now, will not renew. */
  cancelAtPeriodEnd: boolean;
  /** When access ends (or renews, after resume). Null when webhook never
   *  stamped a period end. */
  currentPeriodEnd: string | null;
}

/** 24 = two years monthly, still one Stripe page (no cursor, no pagination). */
export const INVOICE_PAGE_SIZE = 24;

/** `$5.99` / `¥600` — Stripe minor-unit amount in its own currency. */
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
    // `minimumFractionDigits` = currency's minor-unit size: 2 USD, 0 JPY.
    const digits = format.resolvedOptions().minimumFractionDigits ?? 2;
    return format.format(amountMinor / 10 ** digits);
  } catch {
    // Unknown currency code throws in `Intl`. Degrade rather than lose the row.
    return `${(amountMinor / 100).toFixed(2)} ${code}`;
  }
}

/** "Visa •••• 4242" — one card label, page and pane alike. */
export function formatCardLabel(method: PaymentMethodDto): string {
  const brand = method.brand
    ? method.brand.charAt(0).toUpperCase() + method.brand.slice(1)
    : "Card";
  return `${brand} •••• ${method.last4}`;
}

/** "04 / 2029". NULL when Stripe reported no expiry — caller drops the
 *  "Expires" line rather than printing a made-up one. */
export function formatCardExpiry(method: PaymentMethodDto): string | null {
  if (method.expMonth == null || method.expYear == null) return null;
  return `${String(method.expMonth).padStart(2, "0")} / ${method.expYear}`;
}
