import { describe, expect, it } from "vitest";
import type { HomeChannel, HomePendingLink } from "@/features/home/types";
import { hasLinkOut, homeRows, linkGrantLabel, visibleRows } from "./home-rows";

/**
 * The left pane's row math, tested where it is PURE — no DOM, no bridge.
 *
 * ⚠ WHAT THIS PINS IS THE BADGE/FILTER AGREEMENT (2026-08-25). "Links" counts
 * two different shapes — a channel carrying a bound `linkOut`, and a legacy
 * unbound link that is its own row — and the badge is a PROMISE about what
 * picking the filter will show. The two read one predicate for exactly this
 * reason; a second inline copy is how they come to disagree.
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

describe("the Links filter", () => {
  const rows = homeRows({ channels: [PLAIN, INVITED], pendingLinks: [LINK] });

  it("keeps BOTH shapes of open invitation and drops the rest", () => {
    const links = visibleRows(rows, "links", "");
    expect(links.map((row) => row.id).sort()).toEqual([
      "link:link-legacy",
      "rel:ws-2",
    ]);
  });

  it("counts exactly what it shows — the badge cannot over-promise", () => {
    // ⚠ THE BADGE IS `rows.filter(hasLinkOut).length` in `index.tsx`, counted
    // over ALL rows so it does not shrink as you type; this is the invariant
    // that keeps that number honest about the unfiltered list.
    expect(rows.filter(hasLinkOut)).toHaveLength(
      visibleRows(rows, "links", "").length
    );
  });

  it("still narrows by query inside the filter", () => {
    expect(visibleRows(rows, "links", "legacy1")).toHaveLength(1);
    expect(visibleRows(rows, "links", "nobody")).toHaveLength(0);
  });

  it("leaves the All tab showing everything", () => {
    expect(visibleRows(rows, "all", "")).toHaveLength(3);
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
