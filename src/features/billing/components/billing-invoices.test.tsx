/**
 * Invoice table — the one surface here that renders money. Pins the two
 * decisions that pick a number: which amount a row shows (paid vs. due), and
 * how a minor-unit integer becomes a string.
 */

import { describe, it, expect } from "vitest";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { BillingInvoices } from "./billing-invoices";
import { SECTION_PANEL_GROUND } from "@/shared/ui/section-panel";
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
    // A sixth Stripe value can land with no deploy here, making
    // `STATUS_TONE[it]` `undefined` — a pill with no colour class.
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
    // `w-20` fits "$1,234.56" and nothing wider; a zero-decimal ¥ invoice
    // overflowed it.
    const markup = table([
      invoice({ currency: "jpy", amountPaid: 123456789, amountDue: 123456789 }),
    ]);
    expect(markup).toContain("¥123,456,789");
    expect(markup).toContain("min-w-20");
    expect(markup).not.toContain('class="w-20');
  });

  it("renders every row even when the DTO degraded the id away", () => {
    // `toInvoiceDto` falls back to `invoice.id ?? invoice.number ?? ""`, so two
    // rows can share the empty-string id — one React key for two rows.
    const markup = table([
      invoice({ id: "", number: null, amountPaid: 100, amountDue: 100 }),
      invoice({ id: "", number: null, amountPaid: 200, amountDue: 200 }),
    ]);
    expect(markup.match(/<li /g) ?? []).toHaveLength(2);
    expect(markup).toContain("$1.00");
    expect(markup).toContain("$2.00");
  });
});

/**
 * R-39 (2026-09-17): the history is a flat section. It was a `SectionBox` whose
 * concave inset body supplied the frame, the fill and the rows' `px-4` gutter;
 * `SectionPanel` supplies its own `p-3`, so the swap has to land the ground and
 * drop the second inset or the rows step in past their heading. Pinned in every
 * state the body can be.
 */
describe("the invoice history's ground", () => {
  it("is the flat section well, whatever the body is", () => {
    for (const markup of [
      table([invoice()]),
      table([]),
      table(undefined),
    ]) {
      expect(markup).toContain("data-section-panel");
      for (const token of SECTION_PANEL_GROUND.split(" ")) {
        expect(markup).toContain(token);
      }
      expect(markup).toContain("Billing history");
      // The body it stopped being: no concave inset well.
      expect(markup).not.toContain("bg-bg-inset");
      expect(markup).not.toContain("shadow-[inset_");
    }
  });

  it("drops the concave body's own gutter rather than nesting it", () => {
    // `SectionPanel`'s `p-3` is the padding now; `px-4` would be a second.
    expect(table([invoice()])).not.toContain("px-4");
  });
});

describe("formatInvoiceAmount", () => {
  it("reads USD minor units as cents", () => {
    expect(formatInvoiceAmount(599, "usd")).toBe("$5.99");
  });

  it("does NOT divide a zero-decimal currency by 100", () => {
    // ¥600 is six hundred yen, not six. A blanket /100 is the bug.
    expect(formatInvoiceAmount(600, "jpy")).toBe("¥600");
  });

  it("degrades to a readable string on an unknown currency code", () => {
    expect(formatInvoiceAmount(599, "zzz")).toContain("ZZZ");
  });
});
