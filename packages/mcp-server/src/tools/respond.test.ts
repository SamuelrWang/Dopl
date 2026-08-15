/**
 * entitlementDenied — turns an over-free-cap DoplApiError into a friendly
 * tool error (message + upgrade link surfaced verbatim), and leaves every
 * other error alone (returns null so the caller rethrows).
 */

import { describe, it, expect } from "vitest";
import { entitlementDenied } from "./respond.js";

describe("entitlementDenied", () => {
  it("renders the message + upgrade link for an over_free_cap error", () => {
    const res = entitlementDenied({
      status: 403,
      code: "over_free_cap",
      apiMessage: "This workspace has reached the free plan limit of 1,000 objects.",
      upgradeUrl: "https://www.usedopl.com/pricing",
    });
    expect(res).not.toBeNull();
    expect(res?.isError).toBe(true);
    const text = res?.content[0]?.text ?? "";
    expect(text).toContain("free plan limit");
    expect(text).toContain("https://www.usedopl.com/pricing");
  });

  it("still renders a message when no upgrade link is present", () => {
    const res = entitlementDenied({
      code: "over_free_cap",
      apiMessage: "Over the cap.",
    });
    expect(res?.isError).toBe(true);
    expect(res?.content[0]?.text).toBe("Over the cap.");
  });

  it("renders the message + upgrade link for a chat_outside_retention error", () => {
    const res = entitlementDenied({
      status: 403,
      code: "chat_outside_retention",
      apiMessage: "This chat is older than the free plan's 90-day window.",
      upgradeUrl: "https://www.usedopl.com/pricing",
    });
    expect(res?.isError).toBe(true);
    const text = res?.content[0]?.text ?? "";
    expect(text).toContain("90-day window");
    expect(text).toContain("Upgrade to continue");
  });

  it("renders the message + upgrade link for a kb_storage_full error", () => {
    // A `kb_write_file` that would push a base past its plan's per-base
    // storage cap. Reaches the agent as an ordinary 403 from the loopback
    // write, because MCP kb writes ride the same route handlers a browser does.
    const res = entitlementDenied({
      status: 403,
      code: "kb_storage_full",
      apiMessage: '"Specs" has reached its 5 MB storage limit (5 MB used).',
      upgradeUrl: "https://www.usedopl.com/billing",
    });
    expect(res?.isError).toBe(true);
    const text = res?.content[0]?.text ?? "";
    expect(text).toContain("5 MB storage limit");
    expect(text).toContain("https://www.usedopl.com/billing");
  });

  it("falls back to STORAGE wording, not object-cap wording, for kb_storage_full", () => {
    // The fallback chain ends in the object-cap sentence. A storage refusal
    // that fell through to it would tell an agent to delete ontology objects.
    const res = entitlementDenied({ code: "kb_storage_full" });
    const text = res?.content[0]?.text ?? "";
    expect(text).toContain("storage limit");
    expect(text).not.toContain("object limit");
  });

  it("returns null for a different error code (caller rethrows)", () => {
    expect(
      entitlementDenied({ status: 404, code: "NOT_FOUND", apiMessage: "gone" })
    ).toBeNull();
  });

  it("returns null for non-error values", () => {
    expect(entitlementDenied(null)).toBeNull();
    expect(entitlementDenied("boom")).toBeNull();
    expect(entitlementDenied(new Error("plain"))).toBeNull();
  });
});
