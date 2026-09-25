import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type {
  Channel,
  ChannelPeer,
  ChannelPendingLink,
} from "@/features/channels/types";
import {
  channelPeople,
  channelTitle,
  hasLinkOut,
  homeChannels,
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

const LINK: ChannelPendingLink = {
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

/**
 * ONE ROW OF `GET /api/channels?scope=account`. ⚠ **A PARTIAL CAST, not a full
 * `Channel`**: these cases exercise the five row derivations, which read eight of
 * the projection's twenty-six fields, and spelling the other eighteen here would
 * be a second fixture drifting beside `home-test-harness.tsx`'s real one.
 * ⚠ `container.kind` IS SPELLED, and it has to be — it is what G3 filters on, so
 * a fixture without it produces no rows at all (`homeRows`).
 */
function channel(over: Partial<Channel> = {}): Channel {
  return {
    workspaceId: "ws-1",
    container: { id: "ws-1", kind: "link", segment: "link-one-aa11" },
    id: "chan-1",
    name: "Q3 Fundraise",
    topic: "",
    peers: [],
    createdAt: "2026-08-20T09:00:00.000Z",
    lastMessageAt: null,
    unread: false,
    mentionCount: 0,
    myFavoritedAt: null,
    myWorkspaceRole: "owner",
    linkOut: null,
    ...over,
  } as Channel;
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
    const stale: ChannelPendingLink = { ...LINK };
    delete (stale as Partial<ChannelPendingLink>).grantedRole;
    expect(linkGrantLabel(stale)).toBe("Joins as guest");
  });
});

// ── THE ROSTER PRESENTERS (F-307's fix, 2026-08-26) ─────────────────────────
// Samuel's ruling: a home channel takes MORE THAN TWO people. `peers` is the
// list, and `channelPeople` is the only thing on this page that reads it. ⚠ The
// second field it used to merge with (`HomeChannel.peer`) went with the second
// projection (Wave 3, R-26 (b)).

const GRACE: ChannelPeer = {
  userId: "u-grace",
  displayName: "Grace",
  email: "grace@x.dev",
  avatarUrl: null,
};
const PRIYA: ChannelPeer = {
  userId: "u-priya",
  displayName: "Priya",
  email: "priya@x.dev",
  avatarUrl: null,
};
const DANA: ChannelPeer = {
  userId: "u-dana",
  displayName: "Dana",
  email: "dana@x.dev",
  avatarUrl: null,
};
const OMAR: ChannelPeer = {
  userId: "u-omar",
  displayName: "Omar",
  email: "omar@x.dev",
  avatarUrl: null,
};

/** A cached payload written by a bundle that predates one key: it is DELETED,
 *  not null — which is what the IndexedDB cache actually serves after an upgrade. */
function staleCached(key: keyof Channel, over: Partial<Channel> = {}): Channel {
  const row: Record<string, unknown> = { ...channel(over) };
  delete row[key as string];
  return row as unknown as Channel;
}

describe("channelPeople — the ONE read of `peers`", () => {
  it("uses `peers` when it is there", () => {
    expect(channelPeople(channel({ peers: [GRACE, PRIYA] }))).toEqual([
      GRACE,
      PRIYA,
    ]);
  });

  it("keeps an EMPTY `peers` empty — a real solo channel is not a missing key", () => {
    // ⚠ `??` and not `||`: a solo container genuinely has nobody in it, and `||`
    // would send it down the absent-key branch for a value that is not absent.
    expect(channelPeople(channel({ peers: [] }))).toEqual([]);
  });

  /**
   * 🔒 **§8 — THE KEY IS DELETED, not `null` and not `[]`.** Both of those pass a
   * `??` a missing key would also pass while proving nothing about the shape a
   * persisted entry actually has.
   *
   * ⚠ **THE ANSWER IS "NOBODY" NOW, AND THAT IS THE WAVE'S DOING.** This used to
   * degrade to a second field (`HomeChannel.peer`) because falling back to `[]`
   * would have painted every channel as solo on the first paint after the
   * 2026-08-26 upgrade. That payload, that cache entry and that field are all
   * DELETED: the account list is read under a key tuple no bundle has ever
   * written, so no entry carrying `peer` can be served here.
   */
  it("is empty when the key is absent (INVARIANTS §8)", () => {
    expect(channelPeople(staleCached("peers"))).toEqual([]);
  });

  it("reads a STALE `myWorkspaceRole` / `mentionCount` as absent, not as a value", () => {
    // ⚠ THE OTHER TWO NEW KEYS, pinned in the same shape — the READERS spell
    // `?? EMPTY_WORKSPACE_ROLE` / `?? 0` inline, and what this fixes in place is
    // that a deleted key really is `undefined` rather than a default the wire
    // type hides.
    expect(staleCached("myWorkspaceRole").myWorkspaceRole).toBeUndefined();
    expect(staleCached("mentionCount").mentionCount).toBeUndefined();
  });
});

/**
 * 🔒 **G3 — /home SHOWS ONLY HOME CHANNELS, AND THE TEST IS POSITIVE** (master
 * §4.2). `?scope=account` answers every container the caller is in, of every
 * kind; the column can only address `kind='link'` containers, which have no
 * route of their own.
 *
 * ⚠ **THE `home` CASE IS THE SHARP ONE.** It is not a standard workspace
 * either, so a `!isStandardWorkspace(…)` test would ADMIT it — the operator's own
 * shelf would appear as a channel row beside their relationships.
 */
describe("🔒 homeRows keeps ONLY `container.kind === \"link\"` (G3)", () => {
  const payload = {
    channels: [
      channel(),
      channel({
        workspaceId: "ws-std",
        container: { id: "ws-std", kind: "standard", segment: "acme-bb22" },
      }),
      channel({
        workspaceId: "ws-me",
        container: { id: "ws-me", kind: "home", segment: "sam-cc33" },
      }),
    ],
  };

  it("drops standard AND home spaces", () => {
    expect(homeRows(payload).map((row) => row.id)).toEqual(["rel:ws-1"]);
    expect(homeChannels(payload).map((c) => c.workspaceId)).toEqual(["ws-1"]);
  });

  it("drops a row whose `container` key the cache never wrote", () => {
    // ⚠ A POSITIVE TEST FAILS CLOSED, which is the direction this wants: a row
    // /home cannot place is a row it must not offer to open.
    expect(homeRows({ channels: [staleCached("container")] })).toEqual([]);
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
    expect(channelTitle(channel({ peers: [] }))).toBe("Q3 Fundraise");
  });

  it("does NOT rename the channel when people join", () => {
    const solo = channel({ peers: [] });
    const one = channel({ peers: [GRACE] });
    const many = channel({ peers: [GRACE, PRIYA, DANA, OMAR] });
    for (const row of [solo, one, many]) {
      expect(channelTitle(row)).toBe("Q3 Fundraise");
    }
  });

  // ⚠ THE EMAIL IS THE SHARP ONE: a nameless peer used to surface their ADDRESS
  // as the channel's title, which put a stranger's email in the sidebar.
  it("never surfaces a member's email as the title", () => {
    const nameless = { ...GRACE, displayName: null };
    expect(channelTitle(channel({ peers: [nameless] }))).toBe("Q3 Fundraise");
  });

  // A cache entry written before `peers` existed has no roster at all; the title
  // never read one, so the upgrade cannot flash a peer-derived name either.
  it("ignores the roster on a STALE-CACHE row too", () => {
    expect(channelTitle(staleCached("peers"))).toBe("Q3 Fundraise");
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
   * ⚠ **IT IS A PLAIN `?? EMPTY_PEERS` SINCE WAVE 3 (R-26 (b))** — the two-field
   * merge it used to centralise went with the second cache. The pin STAYS anyway:
   * `.peers` read in four panes is four `??`s to forget, and this is the cheap
   * way to keep the answer in one place.
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
    expect(src).toMatch(/channel\.peers \?\? EMPTY_PEERS/);
  });
});
