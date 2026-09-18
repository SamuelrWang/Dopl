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
  channelTitle,
  hasLinkOut,
  homeRows,
  linkGrantLabel,
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
    topic: "",
    peers: [],
    peer: null,
    createdAt: "2026-08-20T09:00:00.000Z",
    lastMessageAt: null,
    lastMessagePreview: null,
    unread: false,
    unreadMentions: 0,
    myFavoritedAt: null,
    role: "owner",
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

/**
 * 🔒 **THE SEARCH NARROWING IS GONE, AND THIS IS THE PIN THAT SAYS SO
 * (2026-09-17).** `visibleRows` and its `searchText` are DELETED — Samuel:
 * *"during search … it like removes channel on the left sidebar. that doesnt
 * make sense, it should be a pop up like this."* The three cases that stood here
 * (empty query shows all, narrows across both row kinds, trimmed and
 * case-insensitive) went with the function they described.
 *
 * ⚠ **A SOURCE SCAN, because the absence is the assertion** and there is no
 * symbol left to call. It fails the day this page grows a second answer to a
 * query — which is exactly how the deleted filter and the popup would start
 * disagreeing.
 */
describe("🔒 this page holds NO search narrowing", () => {
  it("no `visibleRows`, no `searchText`, anywhere under pages/home", () => {
    const dir = import.meta.dirname;
    const offenders = readdirSync(dir)
      .filter((name) => name.endsWith(".ts") || name.endsWith(".tsx"))
      .filter((name) => name !== "home-rows.test.ts")
      .filter((name) =>
        /\b(visibleRows|searchText)\s*\(/.test(
          readFileSync(join(dir, name), "utf8").replace(/\/\*[\s\S]*?\*\//g, "")
        )
      );
    expect(offenders).toEqual([]);
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

/**
 * 🔒 **THE CHANNEL'S NAME, AND NOTHING DERIVED FROM ITS ROSTER (Samuel,
 * 2026-09-01).** These cases replace a suite that pinned the OPPOSITE — a title
 * that was the lone peer's display name, then their email, then two names and a
 * `+N` — which is what made adding a member RENAME a channel. The cases below
 * are deliberately written as "the roster changes and the title does not",
 * because a single `expect(title).toBe(name)` would also pass against a
 * derivation that happened to agree on one fixture.
 */
describe("channelTitle — the CHANNEL's name, never the roster's", () => {
  it("titles a SOLO channel by the channel", () => {
    expect(channelTitle(channel({ peers: [], peer: null }))).toBe("Q3 Fundraise");
  });

  it("does NOT rename the channel when people join", () => {
    const solo = channel({ peers: [], peer: null });
    const one = channel({ peers: [GRACE], peer: GRACE });
    const many = channel({ peers: [GRACE, PRIYA, DANA, OMAR], peer: GRACE });
    for (const row of [solo, one, many]) {
      expect(channelTitle(row)).toBe("Q3 Fundraise");
    }
  });

  // ⚠ THE EMAIL IS THE SHARP ONE: a nameless peer used to surface their ADDRESS
  // as the channel's title, which put a stranger's email in the sidebar.
  it("never surfaces a member's email as the title", () => {
    const nameless = { ...GRACE, displayName: null };
    expect(channelTitle(channel({ peers: [nameless], peer: nameless }))).toBe(
      "Q3 Fundraise"
    );
  });

  // A cache entry written before `peers` existed still has `peer`; the title
  // ignores both, so the upgrade cannot flash a peer-derived name either.
  it("ignores the roster on a STALE-CACHE row too", () => {
    expect(channelTitle(staleCached({ peer: GRACE }))).toBe("Q3 Fundraise");
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
