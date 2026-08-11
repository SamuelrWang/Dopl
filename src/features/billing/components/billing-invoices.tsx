"use client";

import { ExternalLink } from "lucide-react";
import { SectionBox } from "@/shared/ui/section-box";
import { SkeletonLine } from "@/shared/ui/skeleton";
import { cn } from "@/shared/lib/utils";
import { formatDate } from "@/shared/lib/format-time";
import {
  formatInvoiceAmount,
  isInvoiceStatus,
  type InvoiceDto,
  type InvoiceStatus,
} from "../billing-account";
import { useWorkspaceInvoices } from "./use-billing-account";

/**
 * Invoice history — date, amount, status, and a link to Stripe's own hosted
 * copy (the one with the PDF, the tax lines and the billing address on it).
 *
 * NO TABLE PRIMITIVE EXISTS in this design system, so this is the documented
 * substitute: a `SectionBox` body with `divide-border-subtle` rows. Amounts are
 * right-aligned because they are compared down the column, not read across.
 *
 * WHICH AMOUNT. A paid invoice shows what was PAID; an open or uncollectible
 * one shows what is DUE, because "$0.00 paid" on an unpaid invoice reads as
 * free rather than outstanding.
 *
 * A FAILED READ IS NOT AN EMPTY HISTORY. The hook answers `[]` on both paths,
 * so the error branch is checked FIRST — "No invoices yet" on a Stripe 500
 * tells a two-year customer their receipts are gone, which is both false and
 * alarming in the one place where being wrong about money matters.
 */
export function BillingInvoices({ workspaceId }: { workspaceId: string }) {
  const { invoices, loading, isError, retry } = useWorkspaceInvoices(
    workspaceId,
    true
  );

  return (
    <section className="bento px-6 py-5">
      <h2 className="mb-1 text-title font-semibold tracking-tight text-text-primary">
        Invoices
      </h2>
      <p className="mb-4 text-caption text-text-secondary">
        Your most recent charges. Open one for the PDF and full details.
      </p>

      <SectionBox label="Billing history">
        {loading ? (
          <div
            className="space-y-3 px-4 py-3"
            role="status"
            aria-busy="true"
            aria-label="Loading invoices"
          >
            <span className="sr-only">Loading invoices</span>
            <SkeletonLine w="100%" />
            <SkeletonLine w="100%" />
            <SkeletonLine w="66%" />
          </div>
        ) : isError ? (
          <p className="px-4 py-4 text-caption text-danger" role="alert">
            Couldn&apos;t load invoices.{" "}
            <button
              type="button"
              onClick={() => void retry()}
              className="cursor-pointer font-medium underline underline-offset-2 hover:text-text-primary"
            >
              Retry
            </button>
          </p>
        ) : invoices.length === 0 ? (
          <p className="px-4 py-4 text-caption text-text-secondary">
            No invoices yet. The first one appears after your next payment.
          </p>
        ) : (
          <ul className="divide-y divide-border-subtle">
            {invoices.map((invoice, index) => (
              // Stripe always numbers a listed invoice, so `id` is what this
              // keys on. The fallbacks are for the DTO's own degraded path
              // (`id: invoice.id ?? invoice.number ?? ""`): an empty id on two
              // rows would collide into one React key, and index-composing is
              // the only thing left that separates them.
              <InvoiceRow
                key={invoice.id || invoice.number || `invoice-${index}`}
                invoice={invoice}
              />
            ))}
          </ul>
        )}
      </SectionBox>
    </section>
  );
}

function InvoiceRow({ invoice }: { invoice: InvoiceDto }) {
  const settled = invoice.status === "paid";
  const amount = formatInvoiceAmount(
    settled ? invoice.amountPaid : invoice.amountDue,
    invoice.currency
  );
  return (
    <li className="flex items-center gap-3 px-4 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="truncate text-body text-text-primary">
          {formatDate(invoice.created)}
        </div>
        {invoice.number && (
          <div className="truncate text-micro text-text-muted">
            {invoice.number}
          </div>
        )}
      </div>
      <InvoiceStatusPill status={invoice.status} />
      {/* MIN-width, not a fixed width: `w-20` clipped anything longer than
          "$1,234.56", and a yearly Team invoice or a zero-decimal currency
          (¥1,234,567) is exactly that. `min-w-20` keeps the column edge the
          amounts align on, `shrink-0` + `nowrap` keep the number whole, and
          the date block (`min-w-0 flex-1`) is what gives up the space. */}
      <span className="min-w-20 shrink-0 whitespace-nowrap text-right text-body font-medium tabular-nums text-text-primary">
        {amount}
      </span>
      {invoice.hostedInvoiceUrl && (
        <a
          href={invoice.hostedInvoiceUrl}
          target="_blank"
          rel="noreferrer noopener"
          aria-label={`Open invoice ${invoice.number ?? ""} on Stripe`}
          className="shrink-0 text-text-muted transition-colors hover:text-text-secondary"
        >
          <ExternalLink size={13} />
        </a>
      )}
    </li>
  );
}

/** Pill on an INSET body — raised (`bg-bg-elevated`) per the design system. */
const STATUS_TONE: Record<InvoiceStatus, string> = {
  paid: "text-success",
  open: "text-warning",
  draft: "text-text-secondary",
  void: "text-text-muted",
  uncollectible: "text-danger",
};

/**
 * THE PROP IS `string`, NOT `InvoiceStatus`, AND THAT IS THE HONEST TYPE. The
 * DTO calls this field an `InvoiceStatus` on the strength of a cast at the
 * Stripe boundary; Stripe can put a sixth value in a live payload without a
 * deploy on our side, and `STATUS_TONE[thatValue]` is `undefined` — a pill
 * with no tone class, silently. Narrowing at render instead means an
 * unrecognised status still shows what Stripe called it, in the neutral tone,
 * which is the truthful rendering of "we do not know what this one means".
 */
function InvoiceStatusPill({ status }: { status: string | null }) {
  if (!status) return null;
  const tone = isInvoiceStatus(status)
    ? STATUS_TONE[status]
    : "text-text-secondary";
  return (
    <span
      className={cn(
        "shrink-0 rounded-full border border-border-strong bg-bg-elevated px-2 py-0.5 text-caption font-medium capitalize",
        tone
      )}
    >
      {status}
    </span>
  );
}
