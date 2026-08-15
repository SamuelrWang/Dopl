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
 * Invoice history — date, amount, status, link to Stripe's hosted copy.
 *
 * No table primitive in this design system; documented substitute is a
 * `SectionBox` body with `divide-border-subtle` rows.
 *
 * WHICH AMOUNT: paid invoice shows PAID, open/uncollectible shows DUE —
 * "$0.00 paid" on an unpaid invoice reads as free rather than outstanding.
 *
 * ⚠ A FAILED READ IS NOT AN EMPTY HISTORY. Hook answers `[]` on both paths, so
 * the error branch must be checked FIRST.
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
              // ⚠ Fallbacks cover the DTO's degraded path
              // (`id: invoice.id ?? invoice.number ?? ""`): two empty ids
              // would collide into one React key.
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
      {/* ⚠ MIN-width, not fixed: `w-20` clipped anything past "$1,234.56"
          (yearly Team invoice, zero-decimal ¥1,234,567). `min-w-20` holds the
          alignment edge; the date block (`min-w-0 flex-1`) gives up space. */}
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
 * ⚠ Prop is `string`, NOT `InvoiceStatus` — the DTO's type rests on a cast at
 * the Stripe boundary, and Stripe can ship a sixth value with no deploy here,
 * making `STATUS_TONE[value]` silently `undefined`. Narrow at render so an
 * unknown status still shows Stripe's word in the neutral tone.
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
