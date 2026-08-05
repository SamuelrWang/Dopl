/**
 * THE TWO URLS THAT TETHERED THE DESKTOP APP TO THE WEB APP TREE.
 *
 * Both used to name `/{segment}/canvas` — one to open Plans & Billing in a
 * settings modal, one to open the Account pane of the same modal — and both are
 * the reason the retirement plan's §2.3 could not just delete
 * `src/app/[workspaceSlug]` (docs/migration-research/website-retirement-plan.md).
 * They now name the standalone `/billing/{segment}` page, and this pins that:
 * these strings are minted inside a shipped desktop build, so a wrong one
 * cannot be fixed by a deploy.
 */

import { describe, it, expect } from "vitest";
import { accountPagePath, billingPath } from "./open-in-browser";

const SEGMENT = "acme-ab12cd34ef56";

describe("the billing handoff", () => {
  it("opens the standalone billing page for THIS workspace", () => {
    expect(billingPath(SEGMENT)).toBe(`/billing/${SEGMENT}?billing=upgrade`);
  });

  it("carries the plan the user already chose, so checkout opens on arrival", () => {
    expect(billingPath(SEGMENT, "solo")).toBe(
      `/billing/${SEGMENT}?billing=upgrade&plan=solo`
    );
    expect(billingPath(SEGMENT, "team")).toBe(
      `/billing/${SEGMENT}?billing=upgrade&plan=team`
    );
  });

  it("never opens the retiring app tree", () => {
    for (const path of [
      billingPath(SEGMENT),
      billingPath(SEGMENT, "team"),
      accountPagePath(SEGMENT),
    ]) {
      expect(path).not.toContain("/canvas");
      expect(path).not.toContain("/settings");
    }
  });

  it("stays workspace-scoped — a bare /billing would bill the DEFAULT workspace", () => {
    expect(billingPath(SEGMENT)).toContain(`/${SEGMENT}`);
    expect(accountPagePath(SEGMENT)).toContain(`/${SEGMENT}`);
  });
});

describe("the account-deletion handoff", () => {
  it("opens the billing page with no intent — deletion is not a purchase", () => {
    expect(accountPagePath(SEGMENT)).toBe(`/billing/${SEGMENT}`);
  });
});
