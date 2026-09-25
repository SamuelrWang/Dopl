"use client";

import { ExternalLink } from "lucide-react";
import { useWorkspaceEntitlements } from "@/features/billing/components/use-workspace-entitlements";
import { useWorkspaceInvoices } from "@/features/billing/components/use-billing-account";
import { formatInvoiceAmount, type InvoiceDto } from "@/features/billing/billing-account";
import { meetsMinRole, type Role } from "@/features/workspaces/types";
import { formatDate } from "@/shared/lib/format-time";
import { openExternalUrl } from "@/shared/lib/open-external";
import { SkeletonLine } from "@/shared/ui/skeleton";

/**
 * Account → Billing history (Samuel, 2026-09-19: "a place that shows past
 * billing? Basically the price and date"). Next-free; web and desktop Account
 * panes mount it under `./account-subscription`.
 *
 * SAME SCOPING AS CANCEL: the home space (no `workspaceId` → the
 * server resolves the caller's own), plus the open STANDARD workspace for an
 * admin/owner. Source is `GET /api/billing/invoices` (Stripe invoices, one page
 * of `INVOICE_PAGE_SIZE`, admin floor server-side) via `useWorkspaceInvoices`.
 * Each read is enabled only when the status payload says a Stripe customer
 * exists — a never-paid user sends no request.
 *
 * ⚠ Keyed on `has_stripe_customer`, NOT `isPaid`: a canceled plan keeps its
 * customer (the webhook nulls only the subscription), so history outlives it.
 *
 * ROWS ARE PAID CHARGES ONLY (`status === "paid"` and a non-zero amount). The
 * route also returns open/void/draft for the billing page; here those would
 * read as money taken that wasn't. Hidden entirely when no row survives.
 */
export function AccountBillingHistory({
  workspaceId,
  role,
}: {
  workspaceId?: string;
  role?: Role;
}) {
  const personal = useWorkspaceEntitlements(undefined);
  const workspace = useWorkspaceEntitlements(workspaceId);

  const personalOn =
    personal.containerKind === "home" && personal.has_stripe_customer;
  const workspaceOn =
    Boolean(workspaceId) &&
    role !== undefined &&
    meetsMinRole(role, "admin") &&
    workspace.containerKind === "standard" &&
    workspace.has_stripe_customer;

  const mine = useWorkspaceInvoices(undefined, personalOn);
  const theirs = useWorkspaceInvoices(workspaceId, workspaceOn);

  if (!personalOn && !workspaceOn) return null;

  // ⚠ Read each list ONLY behind its own gate: with no `workspaceId` both
  // hooks share one cache key, so a disabled hook still hands back the
  // enabled one's data and every row would draw twice.
  const loading = mine.loading || theirs.loading;
  const isError = mine.isError || theirs.isError;
  const both = personalOn && workspaceOn;

  const rows: Array<{ invoice: InvoiceDto; plan: string | null }> = [
    ...charges(personalOn ? mine.invoices : []).map((invoice) => ({
      invoice,
      plan: both ? "Pro" : null,
    })),
    ...charges(workspaceOn ? theirs.invoices : []).map((invoice) => ({
      invoice,
      plan: both ? "Team" : null,
    })),
  ].sort((a, b) => b.invoice.created.localeCompare(a.invoice.created));

  // Settled on nothing to show → no block at all.
  if (!loading && !isError && rows.length === 0) return null;

  return (
    <section
      aria-label="Billing history"
      className="w-full overflow-hidden rounded-[14px] border border-border-strong"
    >
      <div className="flex items-center bg-card-surface-subtle px-4 py-1.5">
        <span className="text-label font-semibold uppercase tracking-wide text-text-muted">
          Billing history
        </span>
      </div>
      {loading ? (
        <div
          className="space-y-3 p-4"
          role="status"
          aria-busy="true"
          aria-label="Loading billing history"
        >
          <SkeletonLine w="100%" />
          <SkeletonLine w="66%" />
        </div>
      ) : isError ? (
        <p className="p-4 text-caption text-danger" role="alert">
          Couldn&apos;t load billing history.{" "}
          <button
            type="button"
            onClick={() => {
              if (mine.isError) void mine.retry();
              if (theirs.isError) void theirs.retry();
            }}
            className="cursor-pointer font-medium underline underline-offset-2 hover:text-text-primary"
          >
            Retry
          </button>
        </p>
      ) : (
        <ul className="divide-y divide-border-default">
          {rows.map(({ invoice, plan }, index) => (
            <li
              key={invoice.id || invoice.number || `charge-${index}`}
              className="flex items-center gap-3 px-4 py-2.5"
            >
              <span className="min-w-0 flex-1 truncate text-body text-text-primary">
                {formatDate(invoice.created)}
                {plan && (
                  <span className="ml-2 text-caption text-text-muted">{plan}</span>
                )}
              </span>
              <span className="shrink-0 whitespace-nowrap text-right text-body font-medium tabular-nums text-text-primary">
                {formatInvoiceAmount(invoice.amountPaid, invoice.currency)}
              </span>
              {invoice.hostedInvoiceUrl ? (
                <button
                  type="button"
                  // Shared opener: bridge → real browser on desktop (the
                  // packaged shell denies `window.open`), new tab on web.
                  onClick={() => void openExternalUrl(invoice.hostedInvoiceUrl!)}
                  aria-label={`Open receipt for ${formatDate(invoice.created)}`}
                  className="shrink-0 cursor-pointer text-text-muted transition-colors hover:text-text-secondary"
                >
                  <ExternalLink size={13} />
                </button>
              ) : (
                // Holds the column so amounts stay aligned.
                <span className="w-[13px] shrink-0" aria-hidden />
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Money actually taken: paid, non-zero. */
function charges(invoices: InvoiceDto[]): InvoiceDto[] {
  return invoices.filter((i) => i.status === "paid" && i.amountPaid > 0);
}
