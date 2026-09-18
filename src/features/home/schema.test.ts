/**
 * The home request schemas, and the two fields whose SHAPE is the contract:
 * `HomeLinkMintSchema.workspaceId` (a link is bound, or it is not a link), and
 * the `maxUses` field that is DELIBERATELY ABSENT now that a bound link fills
 * one seat by construction.
 */

import { describe, it, expect } from "vitest";
import { ChannelCreateSchema } from "@/features/channels/schema";
import { HomeChannelCreateSchema, HomeLinkMintSchema } from "./schema";

const WS = "33333333-3333-4333-8333-333333333333";

/**
 * One value per class the SHORT-LABEL rule bans, as code points so this file
 * holds no control character of its own: LF, NUL, zero-width space, U+2028.
 */
const FORGERS = [0x0a, 0x00, 0x200b, 0x2028].map(
  (code) => `a${String.fromCharCode(code)}b`
);

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
   * 2026-09-15)** — the EXISTING column, and there must not be a second one.
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
    // (`shared/lib/safe-label.ts`; `channels/schema.ts › ChannelTopicSchema`).
    for (const bad of FORGERS) {
      expect(() =>
        HomeChannelCreateSchema.parse({ name: "A", topic: bad })
      ).toThrow();
    }
  });

  /**
   * ⚠ **THE NAME WEARS THE SAME CHARSET GATE AS THE DESCRIPTION, AND DID NOT
   * UNTIL 2026-09-15.** This field is BOTH the channel's name and its
   * container's (`server/service-writes.ts › createHomeChannel`), and both
   * columns carry the charset CHECK (`channels_name_check`,
   * `workspaces_name_charset_check`) — so a length-only gate here turned a
   * forged name into a 23514 from `insertSoloContainer`, i.e. an opaque 500
   * where the channels route answers 400.
   */
  it("keeps the CHARSET GATE on the NAME too — the same column, the same rule", () => {
    for (const bad of FORGERS) {
      expect(() => HomeChannelCreateSchema.parse({ name: bad })).toThrow();
    }
  });
});

/**
 * ⚠ **TWO DOORS INTO ONE COLUMN, AND THEY MUST NOT DISAGREE.** `POST
 * /api/channels?scope=account` and the container-scope POST both write `channels.name` /
 * `channels.topic`; a value one accepts and the other refuses is a bug in
 * whichever is looser, and the looser one is the one that reaches the DB CHECK
 * as a 500. Both gates come from `shared/lib/safe-label.ts` — this pins that
 * they still do. ⚠ The LENGTH bounds differ on purpose: the home name is also a
 * container name, capped at 80 there.
 */
describe("the home create door and the channels create door agree", () => {
  const throws = (parse: () => unknown) => {
    try {
      parse();
      return false;
    } catch {
      return true;
    }
  };

  it("refuses the same characters in `name` and in `topic`", () => {
    for (const bad of FORGERS) {
      expect(throws(() => HomeChannelCreateSchema.parse({ name: bad }))).toBe(
        throws(() => ChannelCreateSchema.parse({ name: bad }))
      );
      expect(
        throws(() => HomeChannelCreateSchema.parse({ name: "A", topic: bad }))
      ).toBe(throws(() => ChannelCreateSchema.parse({ name: "A", topic: bad })));
    }
  });

  it("agrees on the description's 2000 bound and on empty", () => {
    for (const topic of ["", "Fundraising", "x".repeat(2000), "x".repeat(2001)]) {
      expect(
        throws(() => HomeChannelCreateSchema.parse({ name: "A", topic }))
      ).toBe(throws(() => ChannelCreateSchema.parse({ name: "A", topic })));
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
