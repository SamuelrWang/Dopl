/**
 * entitlementDenied — turns an over-free-cap DoplApiError into a friendly
 * tool error (message + upgrade link surfaced verbatim), and leaves every
 * other error alone (returns null so the caller rethrows).
 *
 * Plus `creditsExhausted` at the UNIT seam: `credits.test.ts` drives the same
 * function through a booted registrar and pins all four wallet sentences, and
 * this file pins the ONE decision that moved on 2026-09-08 — the upgrade line
 * follows `upgradeUrl`, never the wallet.
 */

import { describe, it, expect } from "vitest";
import { creditsExhausted, entitlementDenied } from "./respond.js";

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

  /**
   * 🔒 **THE FALLBACK SENTENCE NAMES A PLAN THAT IS ON SALE FOR THE CONTAINER
   * IT IS TALKING ABOUT.** With no `apiMessage` this layer writes the words
   * itself, and it wrote "upgrade to Pro" while the only `pro`/`solo` plan was
   * the retired single-member WORKSPACE one (`src/features/billing/plans.ts`;
   * checkout still answers 400 `PLAN_RETIRED` for `solo`). ⚠ **THE 2026-09-08
   * PERSONAL PRO TIER DOES NOT REVIVE IT HERE** — this code is a chat-history
   * gate on a workspace and `pro` is sold ONLY on a home space, so
   * "Team" is still the honest remedy. An agent reads this literally.
   */
  it("its chat_outside_retention fallback offers TEAM, never the retired Pro", () => {
    const res = entitlementDenied({ code: "chat_outside_retention" });
    const text = res?.content[0]?.text ?? "";
    expect(text).toContain("upgrade to Team");
    expect(text).not.toMatch(/\bPro\b/);
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

/**
 * ⚠ **`creditsExhausted` DECIDES THE UPGRADE LINE FROM `upgradeUrl` ALONE.**
 * The personal-wallet arm dropped the link unconditionally for one wave, when the
 * home space genuinely had nothing to sell; a personal PRO tier exists since
 * 2026-09-08 (Samuel), and a wallet-keyed rule would now swallow the link the
 * server is handing this function on the surface most agents run on.
 *
 * ⚠ These two are a PAIR and neither alone is the contract: one proves the
 * link appears, the other proves it stays away from somebody already paying.
 */
describe("creditsExhausted — the personal wallet", () => {
  const PERSONAL_PRO_URL =
    "https://www.usedopl.com/billing?billing=upgrade&plan=pro";

  const spent = {
    wallet: "personal" as const,
    used: 500,
    limit: 500,
    periodEnd: "2026-10-01T00:00:00.000Z",
  };

  it("on FREE (the server sent a url) — offers Pro, not Team", () => {
    const text = creditsExhausted({
      ...spent,
      upgradeUrl: PERSONAL_PRO_URL,
      upgradeCredits: 5000,
    }).content[0]?.text;

    expect(text).toBe(
      "Your personal credits are used up for this month (500/500). " +
        `Resets 2026-10-01.\n\nUpgrade to Pro for 5,000 credits a month: ${PERSONAL_PRO_URL}`,
    );
    expect(text).not.toContain("Team");
  });

  it("on PRO (empty url) — the same sentence, and NO upgrade line", () => {
    const text = creditsExhausted({
      ...spent,
      used: 5000,
      limit: 5000,
      upgradeUrl: "",
    }).content[0]?.text;

    expect(text).toBe(
      "Your personal credits are used up for this month (5,000/5,000). Resets 2026-10-01.",
    );
    expect(text).not.toContain("Upgrade");
  });
});

/**
 * 🔒 **F-668 — THE PAID FIGURE IN THE UPSELL COMES OFF THE WIRE, AND THESE PINS
 * ARE WHY IT CANNOT GO BACK TO A LITERAL (2026-09-14).**
 *
 * ⚠ **THE OLD PINS COULD NOT SEE THE DRIFT, AND THAT IS THE WHOLE FINDING.**
 * The sentences said `5,000` and so did the assertions, so they pinned the
 * literal AGAINST ITSELF while `src/features/billing/credits.ts ›
 * SEAT_MONTHLY_CREDITS.team` was free to move underneath them. **These cases
 * feed a figure NO CONSTANT IN THE TREE HOLDS**: the only way they pass is by
 * rendering what the server sent, so re-typing any literal into
 * `creditsExhausted` turns them red.
 *
 * ⚠ **THE OTHER HALF OF THE CHAIN IS APP-SIDE** —
 * `src/features/billing/server/credits-service.test.ts` pins that the figure
 * ON the wire IS the constant. Neither half alone closes the finding: this one
 * says the copy tracks the wire, that one says the wire tracks `credits.ts`.
 */
describe("creditsExhausted — the upgrade figure is the server's (F-668)", () => {
  const URL = "https://www.usedopl.com/billing?billing=upgrade";

  it("renders the SEAT figure it was given, with thousands separators", () => {
    const text = creditsExhausted({
      wallet: "seat",
      upgradeUrl: URL,
      upgradeCredits: 7777,
    }).content[0]?.text;

    expect(text).toContain(`Upgrade to Team for 7,777 credits per member: ${URL}`);
    expect(text).not.toContain("5,000");
  });

  it("renders the PERSONAL figure it was given", () => {
    const text = creditsExhausted({
      wallet: "personal",
      upgradeUrl: URL,
      upgradeCredits: 12345,
    }).content[0]?.text;

    expect(text).toContain(`Upgrade to Pro for 12,345 credits a month: ${URL}`);
  });

  /**
   * ⚠ **AN OLDER SERVER SENDS NO FIGURE, AND THE CLAUSE GOES WITH IT.** Every
   * field on `CreditsOutcome` is optional because the wire makes it so, and a
   * substituted `limit` would advertise the allowance the caller just
   * exhausted as the thing an upgrade buys. `0` is the same case — it is what
   * both degraded answers send.
   */
  it.each([
    ["absent", undefined],
    ["zero", 0],
  ])("drops the whole clause when the figure is %s", (_label, upgradeCredits) => {
    const text = creditsExhausted({
      wallet: "seat",
      used: 100,
      limit: 100,
      upgradeUrl: URL,
      upgradeCredits,
    }).content[0]?.text;

    expect(text).toContain(`Upgrade to Team: ${URL}`);
    expect(text).not.toContain("credits per member");
  });
});
