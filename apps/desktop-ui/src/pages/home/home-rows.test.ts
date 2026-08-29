import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type {
  HomeChannel,
  HomePeer,
  HomePendingLink,
} from "@/features/home/types";
import {
  channelPeople,
  channelSubline,
  channelTitle,
  hasLinkOut,
  homeRows,
  linkGrantLabel,
  visibleRows,
} from "./home-rows";

/**
 * The left pane's row math, tested where it is PURE — no DOM, no bridge.
 *
 * ⚠ `hasLinkOut` ANSWERS FOR TWO SHAPES (2026-08-25) — a channel carrying a
 * bound `linkOut`, and a legacy unbound link that is its own row. It used to
 * feed the "All | Links" filter and its badge as well; both are deleted
 * (2026-08-27, Samuel) and the row's "Link out" chip is the last reader, so
 * what these cases pin is that ONE predicate still recognises BOTH shapes.
 */

const LINK: HomePendingLink = {
  id: "link-legacy",
  url: "https://dopl.link/c/legacy1",
  label: null,
  createdAt: "2026-08-19T09:00:00.000Z",
  expiresAt: null,
  grantedRole: "guest",
  maxUses: 1,
  useCount: 0,
  revokedAt: null,
};

function channel(over: Partial<HomeChannel> = {}): HomeChannel {
  return {
    workspaceId: "ws-1",
    workspaceSegment: "link-one-aa11",
    channelId: "chan-1",
    name: "Q3 Fundraise",
    peers: [],
    peer: null,
    createdAt: "2026-08-20T09:00:00.000Z",
    lastMessageAt: null,
    lastMessagePreview: null,
    linkOut: null,
    ...over,
  };
}

const PLAIN = channel();
const INVITED = channel({
  workspaceId: "ws-2",
  createdAt: "2026-08-21T09:00:00.000Z",
  linkOut: { ...LINK, id: "link-bound" },
});

describe("hasLinkOut", () => {
  it("is true for a bound link and for a legacy row, false for a plain channel", () => {
    const rows = homeRows({
      channels: [PLAIN, INVITED],
      pendingLinks: [LINK],
    });
    const byKind = Object.fromEntries(rows.map((row) => [row.id, hasLinkOut(row)]));
    expect(byKind["rel:ws-1"]).toBe(false);
    expect(byKind["rel:ws-2"]).toBe(true);
    expect(byKind["link:link-legacy"]).toBe(true);
  });
});

describe("visibleRows — the SEARCH narrowing, and nothing else", () => {
  const rows = homeRows({ channels: [PLAIN, INVITED], pendingLinks: [LINK] });

  it("shows EVERY row on an empty query — there is no filter axis left", () => {
    // ⚠ 2026-08-27, Samuel: the "All | Links" segmented filter is DELETED —
    // links are no longer a filterable state. A channel carrying an open
    // invitation and a legacy unbound link fold into this one list exactly like
    // a plain channel does; only the row's own chip tells them apart.
    expect(
      visibleRows(rows, "")
        .map((row) => row.id)
        .sort()
    ).toEqual(["link:link-legacy", "rel:ws-1", "rel:ws-2"]);
  });

  it("narrows by query across BOTH row kinds", () => {
    // The link matches on its URL, the channels on their name.
    expect(visibleRows(rows, "legacy1").map((row) => row.id)).toEqual([
      "link:link-legacy",
    ]);
    expect(visibleRows(rows, "fundraise")).toHaveLength(2);
    expect(visibleRows(rows, "nobody")).toHaveLength(0);
  });

  it("is trimmed and case-insensitive", () => {
    expect(visibleRows(rows, "  LEGACY1 ")).toHaveLength(1);
  });
});

describe("linkGrantLabel — what an open invitation grants", () => {
  it("names the grant, in three words", () => {
    expect(linkGrantLabel({ ...LINK, grantedRole: "guest" })).toBe("Joins as guest");
    expect(linkGrantLabel({ ...LINK, grantedRole: "member" })).toBe("Joins as member");
  });

  it("reads a STALE CACHE ENTRY as guest — the key DELETED, not null (INVARIANTS §8)", () => {
    // ⚠ THE KEY IS REMOVED, which is what a payload written by the previous
    // bundle actually looks like in the IndexedDB-persisted cache (24h
    // `gcTime`). `null` and `{}` would both satisfy a `??` while proving
    // nothing about the shape that ships. The wire type is non-optional and is
    // right; the cache is a different moment.
    const stale: HomePendingLink = { ...LINK };
    delete (stale as Partial<HomePendingLink>).grantedRole;
    expect(linkGrantLabel(stale)).toBe("Joins as guest");
  });
});

// ── THE ROSTER PRESENTERS (F-307's fix, 2026-08-26) ─────────────────────────
// Samuel's ruling: a home channel takes MORE THAN TWO people. `peers` is the
// list, `peer` is its head kept for the cache, and these three functions are the
// only things on this page that know either.

const GRACE: HomePeer = {
  userId: "u-grace",
  displayName: "Grace",
  email: "grace@x.dev",
  avatarUrl: null,
};
const PRIYA: HomePeer = {
  userId: "u-priya",
  displayName: "Priya",
  email: "priya@x.dev",
  avatarUrl: null,
};
const DANA: HomePeer = {
  userId: "u-dana",
  displayName: "Dana",
  email: "dana@x.dev",
  avatarUrl: null,
};
const OMAR: HomePeer = {
  userId: "u-omar",
  displayName: "Omar",
  email: "omar@x.dev",
  avatarUrl: null,
};

/** A payload written by a bundle that predates `peers`: the key is DELETED, not
 *  null — which is what the IndexedDB cache actually serves after an upgrade. */
function staleCached(over: Partial<HomeChannel> = {}): HomeChannel {
  const row: Record<string, unknown> = { ...channel(over) };
  delete row.peers;
  return row as unknown as HomeChannel;
}

describe("channelPeople — the ONE read of `peers`, and the cache merge", () => {
  it("uses `peers` when it is there", () => {
    expect(channelPeople(channel({ peers: [GRACE, PRIYA], peer: GRACE }))).toEqual([
      GRACE,
      PRIYA,
    ]);
  });

  it("keeps an EMPTY `peers` empty — a real solo channel is not a missing key", () => {
    // ⚠ `??` and not `||`, and this is the case that tells them apart: a solo
    // container genuinely has nobody in it, and `||` would send it down the
    // stale-cache branch and resurrect a `peer` that is already null.
    expect(channelPeople(channel({ peers: [], peer: null }))).toEqual([]);
  });

  it("falls back to the SINGLE `peer` when the key is absent — never to nobody", () => {
    // 🔒 THE POINT OF KEEPING `peer` (INVARIANTS §8). On the first paint after
    // the upgrade the cache has `peer` and no `peers`. Degrading to `[]` here
    // would paint every one of the operator's channels as SOLO — "Just you", the
    // agent glyph, no faces — which is a FALSE sentence about who is in the room.
    expect(channelPeople(staleCached({ peer: GRACE }))).toEqual([GRACE]);
  });

  it("is empty when the key is absent AND there was no peer either", () => {
    expect(channelPeople(staleCached({ peer: null }))).toEqual([]);
  });
});

describe("channelTitle — names, then a count", () => {
  it("titles a SOLO channel by the channel", () => {
    expect(channelTitle(channel({ peers: [], peer: null }))).toBe("Q3 Fundraise");
  });

  it("titles ONE peer by the person, falling back email → channel name", () => {
    // ⚠ UNCHANGED BY THE MULTI-PERSON WORK, deliberately — including the
    // `|| channel.name` last resort, which is the only sensible thing left to
    // call a channel whose one member has neither a name nor an address.
    expect(channelTitle(channel({ peers: [GRACE], peer: GRACE }))).toBe("Grace");
    const nameless = { ...GRACE, displayName: null };
    expect(channelTitle(channel({ peers: [nameless], peer: nameless }))).toBe(
      "grace@x.dev"
    );
    const anonymous = { ...GRACE, displayName: null, email: null };
    expect(channelTitle(channel({ peers: [anonymous], peer: anonymous }))).toBe(
      "Q3 Fundraise"
    );
  });

  it("joins TWO names, and counts the rest beyond two", () => {
    expect(
      channelTitle(channel({ peers: [GRACE, PRIYA], peer: GRACE }))
    ).toBe("Grace, Priya");
    expect(
      channelTitle(channel({ peers: [GRACE, PRIYA, DANA, OMAR], peer: GRACE }))
    ).toBe("Grace, Priya +2");
  });

  it("does NOT fall back to the channel name in the multi branch", () => {
    // Naming a crowd after the channel while claiming to name people would
    // attribute the channel to whoever the reader assumes. "Member" is honest.
    const anonymous = { ...DANA, displayName: null, email: null };
    expect(
      channelTitle(channel({ peers: [GRACE, anonymous], peer: GRACE }))
    ).toBe("Grace, Member");
  });

  it("titles a STALE-CACHE row by its single peer, exactly as before the upgrade", () => {
    expect(channelTitle(staleCached({ peer: GRACE }))).toBe("Grace");
  });
});

describe("channelSubline — who this channel is with", () => {
  it("says Just you, then the address, then the size of the room", () => {
    expect(channelSubline(channel({ peers: [], peer: null }))).toBe("Just you");
    expect(channelSubline(channel({ peers: [GRACE], peer: GRACE }))).toBe(
      "grace@x.dev"
    );
    // ⚠ NOT an email. One address under a title naming two OTHER people reads
    // as theirs; the roster on the Info tab is where addresses can be attributed.
    expect(
      channelSubline(channel({ peers: [GRACE, PRIYA, DANA], peer: GRACE }))
    ).toBe("3 people");
  });

  it("leaves the line blank for a lone peer with no address on file", () => {
    const nameless = { ...GRACE, email: null };
    expect(channelSubline(channel({ peers: [nameless], peer: nameless }))).toBe("");
  });
});

describe("search reaches EVERY member, not just the first", () => {
  it("finds a four-person channel by the name of somebody buried in it", () => {
    // ⚠ THE BUG THIS PINS: search read `peer` alone, which was the whole roster
    // only while the two-member cap held. Querying "Omar" would have returned
    // "No matches" over a channel he is in, and the operator has no way to tell
    // that from the channel not existing.
    const crowded = channel({ peers: [GRACE, PRIYA, DANA, OMAR], peer: GRACE });
    const rows = homeRows({ channels: [crowded], pendingLinks: [] });
    expect(visibleRows(rows, "omar")).toHaveLength(1);
    expect(visibleRows(rows, "dana@x.dev")).toHaveLength(1);
    expect(visibleRows(rows, "nobody")).toHaveLength(0);
  });
});

describe("🔒 `peers` IS READ IN EXACTLY ONE PLACE (INVARIANTS §8's enforcement)", () => {
  /**
   * ⚠ THE ASSERTION IS AN ABSENCE, and it is what buys `channelPeople` its
   * exemption from §8's "spell the fallback INLINE" clause. That clause exists
   * because a helper nobody must call is a rule the next read forgets — so the
   * rule is ENFORCED here instead: any new file on this page that reaches for
   * `.peers` directly turns this red, and the fix is to call `channelPeople`.
   *
   * The merge it centralises is not a plain `?? EMPTY_X`: it is "the key, or
   * else the legacy single field, or else nobody", and two copies of THAT which
   * drift is a worse bug than one forgotten `??`.
   *
   * ⚠ COMMENTS ARE SKIPPED — several docblocks name the field while explaining
   * this very rule, and a pin that forbade discussing itself would be absurd.
   */
  const DIR = import.meta.dirname;
  /** The presenter itself, and the fixture builder that must CONSTRUCT the
   *  stale shape in order for the tests above to have anything to cover. */
  const ALLOWED = new Set(["home-rows.ts", "home-test-harness.tsx"]);

  it("no other file on the home page names `.peers` outside a comment", () => {
    const offenders: string[] = [];
    for (const file of readdirSync(DIR)) {
      if (!/\.tsx?$/.test(file) || file.endsWith(".test.ts") || file.endsWith(".test.tsx")) {
        continue;
      }
      if (ALLOWED.has(file)) continue;
      readFileSync(join(DIR, file), "utf8")
        .split("\n")
        .forEach((line, i) => {
          const code = line.trim();
          if (code.startsWith("*") || code.startsWith("//") || code.startsWith("/*")) return;
          if (/\.peers\b/.test(code)) offenders.push(`${file}:${i + 1}`);
        });
    }
    expect(offenders).toEqual([]);
  });

  it("and the one place that DOES read it really is the presenter", () => {
    // Otherwise the absence above would be measuring a rule nothing implements.
    const src = readFileSync(join(DIR, "home-rows.ts"), "utf8");
    expect(src).toMatch(/channel\.peers \?\? \(channel\.peer \? \[channel\.peer\] : EMPTY_PEERS\)/);
  });
});
