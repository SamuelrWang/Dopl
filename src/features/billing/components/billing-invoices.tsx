"use client";

import { ExternalLink } from "lucide-react";
import { SectionBox } from "@/shared/ui/section-box";
import { SkeletonLine } from "@/shared/ui/skeleton";
import { cn } from "@/shared/lib/utils";
import { formatDate } from "@/shared/lib/format-time";
import {
  formatInvoiceAmount,
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
 */
export function BillingInvoices({ workspaceId }: { workspaceId: string }) {
  const { invoices, loading } = useWorkspaceInvoices(workspaceId, true);

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
        ) : invoices.length === 0 ? (
          <p className="px-4 py-4 text-caption text-text-secondary">
            No invoices yet. The first one appears after your next payment.
          </p>
        ) : (
          <ul className="divide-y divide-border-subtle">
            {invoices.map((invoice) => (
              <InvoiceRow key={invoice.id} invoice={invoice} />
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
        <div className="text-body text-text-primary">
          {formatDate(invoice.created)}
        </div>
        {invoice.number && (
          <div className="text-micro text-text-muted">{invoice.number}</div>
        )}
      </div>
      <InvoiceStatusPill status={invoice.status} />
      <span className="w-20 text-right text-body font-medium tabular-nums text-text-primary">
        {amount}
      </span>
      {invoice.hostedInvoiceUrl && (
        <a
          href={invoice.hostedInvoiceUrl}
          target="_blank"
          rel="noreferrer noopener"
          aria-label={`Open invoice ${invoice.number ?? ""} on Stripe`}
          className="text-text-muted transition-colors hover:text-text-secondary"
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

function InvoiceStatusPill({ status }: { status: InvoiceStatus | null }) {
  if (!status) return null;
  return (
    <span
      className={cn(
        "rounded-full border border-border-strong bg-bg-elevated px-2 py-0.5 text-caption font-medium capitalize",
        STATUS_TONE[status]
      )}
    >
      {status}
    </span>
  );
}
