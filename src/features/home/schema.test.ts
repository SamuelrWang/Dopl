/**
 * `HomeLinkMintSchema` — the one field whose ABSENCE means something different
 * from its null.
 *
 * A home link is "here, talk to me", sent to one person. An omitted `maxUses`
 * that minted an unlimited link handed a forwarded URL to everybody who ever
 * saw it, silently, with the desktop picker still reading "Single use".
 */

import { describe, it, expect } from "vitest";
import { HomeLinkMintSchema } from "./schema";

describe("maxUses", () => {
  it("absent is SINGLE-use, not unlimited", () => {
    expect(HomeLinkMintSchema.parse({}).maxUses).toBe(1);
    expect(HomeLinkMintSchema.parse({ label: "bio" }).maxUses).toBe(1);
  });

  it("an EXPLICIT null is multi-use — the caller meant it", () => {
    expect(HomeLinkMintSchema.parse({ maxUses: null }).maxUses).toBeNull();
  });

  it("keeps a stated count, and still refuses a nonsense one", () => {
    expect(HomeLinkMintSchema.parse({ maxUses: 25 }).maxUses).toBe(25);
    expect(() => HomeLinkMintSchema.parse({ maxUses: 0 })).toThrow();
    expect(() => HomeLinkMintSchema.parse({ maxUses: 1001 })).toThrow();
  });
});

describe("expiresAt", () => {
  it("absent is no expiry; a PAST instant is a validation failure, not a link", () => {
    expect(HomeLinkMintSchema.parse({}).expiresAt).toBeUndefined();
    expect(() =>
      HomeLinkMintSchema.parse({ expiresAt: "2020-01-01T00:00:00.000Z" })
    ).toThrow();
    const future = new Date(Date.now() + 86_400_000).toISOString();
    expect(HomeLinkMintSchema.parse({ expiresAt: future }).expiresAt).toBe(future);
  });
});
