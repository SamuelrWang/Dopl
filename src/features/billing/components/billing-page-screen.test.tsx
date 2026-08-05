/**
 * WHAT THE BILLING PAGE IS, AND WHAT IT MUST NEVER BECOME.
 *
 * The page exists so the `src/app/[workspaceSlug]` tree can be deleted. That
 * makes its import graph, not its markup, the load-bearing property: one
 * `AppShell` import and the page drags the rail, the sidebar, the workspaces
 * fetch, the tour and the graph engine back into the KEEP set, and Stage D
 * stops being a deletion. So this file pins both halves — the two panes are
 * really there, and the app shell really is not.
 */

import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, refresh: () => {} }),
}));

import { BillingPageScreen } from "./billing-page-screen";

function paint(node: ReactElement): string {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>{node}</QueryClientProvider>
  );
}

function screen(overrides: Partial<Parameters<typeof BillingPageScreen>[0]> = {}) {
  return paint(
    <BillingPageScreen
      workspaceName="Acme"
      workspaceId="ws-1"
      role="owner"
      billingReturn={null}
      initialCheckoutPlan={null}
      {...overrides}
    />
  );
}

describe("what the page carries", () => {
  it("names the workspace being billed", () => {
    // A multi-workspace admin arriving from a Stripe return has to be able to
    // tell WHICH workspace this is before they read a price.
    expect(screen()).toContain("Acme");
  });

  it("carries Plans & Billing — plan, entitlements, upgrade, portal", () => {
    const markup = screen();
    expect(markup).toContain("Plans and Billing");
    expect(markup).toContain("Starter");
    expect(markup).toContain("Team");
  });

  it("carries the account danger zone the desktop app links out to", () => {
    // `apps/desktop-ui/.../account-actions.tsx` opens this page for deletion
    // (plan decision D4): the flow it runs — API delete, Supabase sign-out,
    // redirect — is not reproducible in the packaged renderer.
    const markup = screen();
    expect(markup).toContain("Danger zone");
    expect(markup).toContain("Delete account");
  });

  it("passes the post-checkout signal straight through to the pane", () => {
    expect(screen({ billingReturn: "success" })).toContain(
      "Finalizing your subscription"
    );
  });

  it("passes the chosen plan straight through to checkout", () => {
    expect(screen({ initialCheckoutPlan: "team" })).toContain("Subscribe to Team");
  });
});

describe("what the page deliberately leaves out", () => {
  const SOURCES = [
    "src/features/billing/components/billing-page-screen.tsx",
    "src/app/billing/[segment]/page.tsx",
    "src/app/billing/page.tsx",
  ];

  it.each(SOURCES)("%s imports nothing from the retiring app tree", (file) => {
    const source = readFileSync(path.join(process.cwd(), file), "utf8");
    const imports = source
      .split("\n")
      .filter((line) => /^\s*import\b/.test(line) || /^\s*}\s*from\s+"/.test(line));
    for (const forbidden of [
      "@/shared/layout/app-shell",
      "@/features/tour",
      "@/features/onboarding/components",
      "@/features/workspaces/components/join-request-notices",
    ]) {
      expect(imports.join("\n")).not.toContain(forbidden);
    }
  });

  it("renders no app chrome — no rail, no sidebar, no settings modal", () => {
    const markup = screen();
    expect(markup).not.toContain("role=\"dialog\"");
    expect(markup).not.toContain("Workspace switcher");
    // The settings modal's own nav — if this ever appears, the page has
    // re-absorbed the shell it was built to replace.
    expect(markup).not.toContain("Plans &amp; Billing");
  });

  it("leaves the profile editor and the workspace icon uploader to the app", () => {
    const markup = screen();
    expect(markup).not.toContain("Display name");
    expect(markup).not.toContain("Workspace icon");
  });
});
