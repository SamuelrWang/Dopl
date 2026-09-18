/**
 * The row badge's arithmetic. ⚠ These cases arrived from
 * `home/server/unread-tally.ts`'s suite in Wave 3 (R-26) with the rule itself;
 * `isChannelUnread`'s cases did NOT come, because that function was a duplicate of
 * `dto.ts › mapChannelRow`'s `unread` and is deleted rather than moved.
 */

import { describe, it, expect } from "vitest";
import { mentionCutoff, mentionScanFloor, tallyMentions } from "./mention-tally";

const BIRTH = "2026-09-01T00:00:00.000Z";

describe("mentionCutoff", () => {
  it("is the caller's watermark when they have read the channel", () => {
    expect(mentionCutoff("2026-09-13T10:00:00Z", BIRTH)).toBe(
      "2026-09-13T10:00:00Z"
    );
  });

  it("falls back to the CHANNEL's birth, which is a sound floor and not a guess", () => {
    // No message can predate its channel, so this is "everything" expressed as an
    // instant — which is what lets `mentionScanFloor` bound the scan at all.
    expect(mentionCutoff(null, BIRTH)).toBe(BIRTH);
  });
});

describe("mentionScanFloor", () => {
  it("is the MINIMUM, never the maximum", () => {
    // 🔒 A maximum here is a SILENT BUG, not a slower query: a channel read a
    // month after its neighbour would have that neighbour's unread mentions
    // filtered out in SQL, where no tally could recover them.
    expect(
      mentionScanFloor(["2026-09-13T00:00:00Z", "2026-09-01T00:00:00Z"])
    ).toBe("2026-09-01T00:00:00Z");
  });

  it("compares INSTANTS, not ISO strings", () => {
    // Postgres writes `+00:00` with microseconds; JS writes `Z` with millis, so
    // lexicographic `<` is wrong on this pair.
    expect(
      mentionScanFloor(["2026-09-01T00:00:00.000Z", "2026-09-01T00:00:00+00:00"])
    ).toBe("2026-09-01T00:00:00.000Z");
  });

  it("is null for an empty page — the repository reads that as no floor", () => {
    expect(mentionScanFloor([])).toBeNull();
  });
});

describe("tallyMentions", () => {
  const cutoffs = new Map([["a", "2026-09-13T12:00:00Z"]]);

  it("counts only stamps strictly newer than that channel's cutoff", () => {
    const out = tallyMentions(
      [
        { channelId: "a", createdAt: "2026-09-13T13:00:00Z" },
        { channelId: "a", createdAt: "2026-09-13T12:00:00Z" },
        { channelId: "a", createdAt: "2026-09-13T11:00:00Z" },
      ],
      cutoffs
    );
    expect(out.get("a")).toBe(1);
  });

  it("DROPS a stamp for a channel with no cutoff rather than counting it", () => {
    // There is no watermark there that opening the channel could advance, so a
    // badge could never be cleared — `Channel.unread`'s `isMember` clause.
    const out = tallyMentions(
      [{ channelId: "b", createdAt: "2099-01-01T00:00:00Z" }],
      cutoffs
    );
    expect(out.has("b")).toBe(false);
  });

  it("has NO entry for a channel with nothing unread — absent reads as 0", () => {
    expect(tallyMentions([], cutoffs).get("a")).toBeUndefined();
  });
});
