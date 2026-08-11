/**
 * THE INVOICE TABLE — the one surface on this page that renders MONEY.
 *
 * A meter that is wrong looks wrong. An amount that is wrong looks fine, which
 * is why the pins here are about the two decisions that pick a number: WHICH
 * amount a row shows (paid vs. due), and how a minor-unit integer becomes a
 * string. The `formatInvoiceAmount` cases are unit-level on purpose — a
 * zero-decimal currency is the case that only a division by 100 gets wrong.
 */

import { describe, it, expect } from "vitest";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { BillingInvoices } from "./billing-invoices";
import { BILLING_INVOICES_PATH } from "./use-billing-account";
import {
  formatInvoiceAmount,
  isInvoiceStatus,
  type InvoiceDto,
} from "../billing-account";

function invoice(overrides: Partial<InvoiceDto> = {}): InvoiceDto {
  return {
    id: "in_1",
    number: "DOPL-0001",
    // Midday UTC: `formatDate` renders in the runner's timezone.
    created: "2026-07-04T12:00:00.000Z",
    amountPaid: 3196,
    amountDue: 3196,
    currency: "usd",
    status: "paid",
    hostedInvoiceUrl: "https://invoice.stripe.com/i/1",
    ...overrides,
  };
}

function paint(node: ReactElement, invoices: InvoiceDto[] | undefined): string {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  if (invoices) {
    client.setQueryData([BILLING_INVOICES_PATH, "ws-1", undefined], {
      invoices,
    });
  }
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>{node}</QueryClientProvider>
  );
}

const table = (invoices: InvoiceDto[] | undefined) =>
  paint(<BillingInvoices workspaceId="ws-1" />, invoices);

describe("what a row says", () => {
  it("renders the date, number, status and hosted link", () => {
    const markup = table([invoice()]);
    expect(markup).toContain("Jul 4, 2026");
    expect(markup).toContain("DOPL-0001");
    expect(markup).toContain("paid");
    expect(markup).toContain("https://invoice.stripe.com/i/1");
  });

  it("shows what was PAID on a settled invoice", () => {
    expect(table([invoice({ amountPaid: 3196, amountDue: 0 })])).toContain(
      "$31.96"
    );
  });

  it("shows what is DUE on an unpaid one", () => {
    // `$0.00 paid` on an open invoice reads as free rather than outstanding.
    const markup = table([
      invoice({ status: "open", amountPaid: 0, amountDue: 799 }),
    ]);
    expect(markup).toContain("$7.99");
    expect(markup).not.toContain("$0.00");
  });

  it("drops the link when Stripe minted no hosted page", () => {
    expect(table([invoice({ hostedInvoiceUrl: null })])).not.toContain(
      "invoice.stripe.com"
    );
  });
});

describe("the empty and loading states", () => {
  it("says there are none rather than rendering an empty box", () => {
    expect(table([])).toContain("No invoices yet");
  });

  it("shows a skeleton, never the words 'Loading…'", () => {
    const markup = table(undefined);
    expect(markup).toContain('aria-busy="true"');
    expect(markup).not.toContain("Loading…");
    expect(markup).not.toContain("No invoices yet");
  });
});

describe("a status Stripe invented after we shipped", () => {
  it("recognises exactly the five we have meaning for", () => {
    expect(isInvoiceStatus("paid")).toBe(true);
    expect(isInvoiceStatus("uncollectible")).toBe(true);
    expect(isInvoiceStatus("disputed")).toBe(false);
    expect(isInvoiceStatus(null)).toBe(false);
  });

  it("renders an unrecognised one in the NEUTRAL tone, not untoned", () => {
    // The DTO calls this field an `InvoiceStatus` on the strength of a cast at
    // the Stripe boundary. A sixth value can land in a live payload with no
    // deploy on our side, and `STATUS_TONE[it]` is `undefined` — a pill with no
    // colour class at all, silently.
    const markup = table([
      invoice({ status: "disputed" as InvoiceDto["status"] }),
    ]);
    expect(markup).toContain("disputed");
    expect(markup).toContain("text-text-secondary");
    expect(markup).not.toContain("undefined");
  });
});

describe("a row that has to hold a long number", () => {
  it("keeps the whole amount rather than clipping it to a fixed column", () => {
    // `w-20` fits "$1,234.56" and nothing wider. A zero-decimal currency has no
    // subunit to hide behind, so a real ¥ invoice is exactly the case that
    // overflowed. `min-w-20` holds the alignment edge; the date gives up space.
    const markup = table([
      invoice({ currency: "jpy", amountPaid: 123456789, amountDue: 123456789 }),
    ]);
    expect(markup).toContain("¥123,456,789");
    expect(markup).toContain("min-w-20");
    expect(markup).not.toContain('class="w-20');
  });

  it("renders every row even when the DTO degraded the id away", () => {
    // `toInvoiceDto` falls back to `invoice.id ?? invoice.number ?? ""`, so two
    // draft-ish rows can arrive sharing the empty-string id — one React key for
    // two rows. The index-composed fallback is what keeps them separate.
    const markup = table([
      invoice({ id: "", number: null, amountPaid: 100, amountDue: 100 }),
      invoice({ id: "", number: null, amountPaid: 200, amountDue: 200 }),
    ]);
    expect(markup.match(/<li /g) ?? []).toHaveLength(2);
    expect(markup).toContain("$1.00");
    expect(markup).toContain("$2.00");
  });
});

describe("formatInvoiceAmount", () => {
  it("reads USD minor units as cents", () => {
    expect(formatInvoiceAmount(599, "usd")).toBe("$5.99");
  });

  it("does NOT divide a zero-decimal currency by 100", () => {
    // ¥600 is six hundred yen, not six. A blanket /100 is the bug this exists
    // to prevent.
    expect(formatInvoiceAmount(600, "jpy")).toBe("¥600");
  });

  it("degrades to a readable string on an unknown currency code", () => {
    expect(formatInvoiceAmount(599, "zzz")).toContain("ZZZ");
  });
});
