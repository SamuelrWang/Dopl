/**
 * The two URLs the desktop app hands to the browser, pinned to the standalone
 * `/billing/{segment}` page. ⚠ These strings are minted inside a SHIPPED
 * desktop build, so a wrong one cannot be fixed by a deploy.
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
