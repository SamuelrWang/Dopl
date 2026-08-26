/**
 * The home request schemas, and the two fields whose SHAPE is the contract:
 * `HomeLinkMintSchema.workspaceId` (a link is bound, or it is not a link), and
 * the `maxUses` field that is DELIBERATELY ABSENT now that a bound link fills
 * one seat by construction.
 */

import { describe, it, expect } from "vitest";
import { HomeChannelCreateSchema, HomeLinkMintSchema } from "./schema";

const WS = "33333333-3333-4333-8333-333333333333";

describe("HomeChannelCreateSchema", () => {
  it("takes a trimmed name and refuses an empty or oversized one", () => {
    expect(HomeChannelCreateSchema.parse({ name: "  Fundraise  " }).name).toBe(
      "Fundraise"
    );
    expect(() => HomeChannelCreateSchema.parse({ name: "   " })).toThrow();
    expect(() => HomeChannelCreateSchema.parse({})).toThrow();
    expect(() =>
      HomeChannelCreateSchema.parse({ name: "x".repeat(81) })
    ).toThrow();
  });
});

describe("HomeLinkMintSchema", () => {
  it("REQUIRES a workspaceId — an unbound mint is not a thing any more", () => {
    expect(HomeLinkMintSchema.parse({ workspaceId: WS }).workspaceId).toBe(WS);
    expect(() => HomeLinkMintSchema.parse({})).toThrow();
    expect(() => HomeLinkMintSchema.parse({ workspaceId: "nope" })).toThrow();
  });

  it("has NO maxUses field — the seat cap answers what it used to ask", () => {
    // ⚠ Zod strips unknown keys rather than throwing, so the assertion is the
    // ABSENCE from the parsed output: a client still sending `maxUses` gets a
    // single-use link, never the unlimited one the old explicit `null` bought.
    const parsed = HomeLinkMintSchema.parse({ workspaceId: WS, maxUses: null });
    expect(parsed).not.toHaveProperty("maxUses");
  });

  it("absent is no expiry; a PAST instant is a validation failure, not a link", () => {
    expect(HomeLinkMintSchema.parse({ workspaceId: WS }).expiresAt).toBeUndefined();
    expect(() =>
      HomeLinkMintSchema.parse({
        workspaceId: WS,
        expiresAt: "2020-01-01T00:00:00.000Z",
      })
    ).toThrow();
    const future = new Date(Date.now() + 86_400_000).toISOString();
    expect(
      HomeLinkMintSchema.parse({ workspaceId: WS, expiresAt: future }).expiresAt
    ).toBe(future);
  });
});
