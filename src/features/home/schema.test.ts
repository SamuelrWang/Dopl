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

  /**
   * ⚠ **`topic` IS THE FIELD THE PRODUCT CALLS "DESCRIPTION" (ruling, Samuel,
   * 2026-09-15).** The New-channel popup's second field writes the EXISTING
   * `channels.topic` column; there is no new one and there must not be one. The
   * cap and the charset gate are the channels feature's, restated — a looser
   * pair here would let a value the channels surface refuses into the same
   * column, and that column is spliced into MCP server narration.
   */
  it("takes an OPTIONAL description on the `topic` field, trimmed, at 2000", () => {
    expect(HomeChannelCreateSchema.parse({ name: "A" }).topic).toBeUndefined();
    expect(
      HomeChannelCreateSchema.parse({ name: "A", topic: "  Fundraising  " })
        .topic
    ).toBe("Fundraising");
    // ⚠ `""` STAYS LEGAL — the column is `NOT NULL DEFAULT ''` and the popup's
    // own cleared field is the ordinary case.
    expect(HomeChannelCreateSchema.parse({ name: "A", topic: "" }).topic).toBe(
      ""
    );
    expect(
      HomeChannelCreateSchema.parse({ name: "A", topic: "x".repeat(2000) }).topic
    ).toHaveLength(2000);
    expect(() =>
      HomeChannelCreateSchema.parse({ name: "A", topic: "x".repeat(2001) })
    ).toThrow();
  });

  it("keeps the CHARSET GATE — a description cannot forge a line", () => {
    // ⚠ The value is spliced into `dopl_channel` results as SERVER NARRATION, so
    // a line separator forges a line and a length bound alone is not enough
    // (`shared/lib/safe-label.ts`, and `channels/schema.ts › ChannelTopicSchema`
    // which this restates). The four codes are LF, NUL, zero-width space and
    // U+2028 — written as code points so this file holds no control character
    // of its own.
    for (const code of [0x0a, 0x00, 0x200b, 0x2028]) {
      const bad = `a${String.fromCharCode(code)}b`;
      expect(() =>
        HomeChannelCreateSchema.parse({ name: "A", topic: bad })
      ).toThrow();
    }
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
