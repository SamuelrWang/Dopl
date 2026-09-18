// @vitest-environment jsdom
/**
 * THE SEARCH HOOK'S RULES, tested where they are PURE — the section model, the
 * sanitiser, and the recents store. The CARD's behaviour (when it opens, what
 * the arrows do, what Enter hands back) is `components/search-popup.test.tsx`.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import type { SearchGroup, SearchItem } from "./contracts";
import { SEARCH_GROUP_ORDER } from "./contracts";
import {
  GROUP_LABEL,
  flatItems,
  moveIndex,
  orderedGroups,
  sanitizeSnippet,
} from "./components/search-popup-sections";
import { RECENTS_MAX, readRecents, writeRecent } from "./use-search";

const item = (over: Partial<SearchItem> & Pick<SearchItem, "id" | "kind">): SearchItem => ({
  title: over.id,
  containerId: "ws-1",
  ...over,
});

const group = (kind: SearchGroup["kind"], ids: string[]): SearchGroup => ({
  kind,
  total: ids.length,
  items: ids.map((id) => item({ id, kind })),
});

describe("the section model", () => {
  it("🔒 renders in PAYLOAD order and SORTS NOTHING", () => {
    // The order is the contract's (`contracts.ts › SEARCH_GROUP_ORDER`), so a
    // client-side sort would be a second answer. This payload is deliberately NOT
    // in that order: the renderer must hand it back untouched.
    const groups = [
      group("knowledge", ["k1"]),
      group("channels", ["c1"]),
      group("messages", ["m1"]),
    ];
    expect(orderedGroups(groups).map((g) => g.kind)).toEqual([
      "knowledge",
      "channels",
      "messages",
    ]);
  });

  it("DROPS an empty group — a hairline with a label and nothing under it is a claim", () => {
    const groups = [group("channels", ["c1"]), { kind: "skills" as const, total: 0, items: [] }];
    expect(orderedGroups(groups).map((g) => g.kind)).toEqual(["channels"]);
  });

  it("DROPS a kind this bundle cannot render, rather than appending it", () => {
    // A newer server may grow a group with no row renderer and no label here;
    // appending it paints an unlabelled section of `undefined`.
    const rogue = { kind: "invoices", total: 1, items: [{ id: "x", kind: "invoices", title: "x", containerId: "w" }] };
    const groups = [group("channels", ["c1"]), rogue as unknown as SearchGroup];
    expect(orderedGroups(groups).map((g) => g.kind)).toEqual(["channels"]);
  });

  it("flattens ACROSS the groups, in render order — that IS the arrow-key order", () => {
    const groups = [group("messages", ["m1", "m2"]), group("channels", ["c1"])];
    expect(flatItems(groups).map((i) => i.id)).toEqual(["m1", "m2", "c1"]);
  });

  it("every kind the CONTRACT can send has a label here", () => {
    // Read off `SEARCH_GROUP_ORDER`, so a kind added with no label is a red test
    // rather than an empty hairline.
    for (const kind of SEARCH_GROUP_ORDER) expect(GROUP_LABEL[kind]).toBeTruthy();
  });

  it("wraps at both ends, like every menu in the app", () => {
    expect(moveIndex(0, -1, 3)).toBe(2);
    expect(moveIndex(2, 1, 3)).toBe(0);
    // And it never divides by an empty list.
    expect(moveIndex(0, 1, 0)).toBe(0);
  });
});

describe("the snippet sanitiser", () => {
  it("keeps `<mark>` and nothing else", () => {
    expect(sanitizeSnippet("the <mark>q4</mark> list")).toBe("the <mark>q4</mark> list");
  });

  it("escapes every other tag rather than stripping it", () => {
    // Allow-list by reconstruction: a strip pass is a blocklist, and every
    // blocklist has a bypass — the nested case below is the classic one.
    expect(sanitizeSnippet('<img src=x onerror="alert(1)">')).toBe(
      "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;"
    );
    expect(sanitizeSnippet("<scr<script>ipt>")).toBe("&lt;scr&lt;script&gt;ipt&gt;");
  });

  it("does not let an attribute ride in on the allowed tag", () => {
    expect(sanitizeSnippet('<mark onclick="x">hi</mark>')).toBe(
      '&lt;mark onclick=&quot;x&quot;&gt;hi</mark>'
    );
  });

  it("escapes a bare ampersand", () => {
    expect(sanitizeSnippet("Q4 & Q1")).toBe("Q4 &amp; Q1");
  });
});

describe("recents — five, per user, newest first", () => {
  afterEach(() => {
    globalThis.localStorage?.clear();
    vi.restoreAllMocks();
  });

  it("writes newest-first and reads back what it wrote", () => {
    writeRecent("alpha", "u1");
    writeRecent("beta", "u1");
    expect(readRecents("u1")).toEqual(["beta", "alpha"]);
  });

  it("de-duplicates case-insensitively — one entry, moved to the front", () => {
    writeRecent("Alpha", "u1");
    writeRecent("beta", "u1");
    writeRecent("ALPHA", "u1");
    expect(readRecents("u1")).toEqual(["ALPHA", "beta"]);
  });

  it(`caps at ${RECENTS_MAX}`, () => {
    for (let i = 0; i < RECENTS_MAX + 3; i += 1) writeRecent(`q${i}`, "u1");
    expect(readRecents("u1")).toHaveLength(RECENTS_MAX);
    expect(readRecents("u1")[0]).toBe(`q${RECENTS_MAX + 2}`);
  });

  it("is KEYED BY USER — one machine holds more than one account", () => {
    writeRecent("mine", "u1");
    expect(readRecents("u2")).toEqual([]);
  });

  it("stores nothing for an empty or blank query", () => {
    writeRecent("   ", "u1");
    expect(readRecents("u1")).toEqual([]);
  });

  it("🔒 survives a THROWING localStorage — the read answers empty, the write is a no-op", () => {
    // It throws outright in a private window and with site data blocked.
    const boom = () => {
      throw new Error("blocked");
    };
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(boom);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(boom);
    expect(readRecents("u1")).toEqual([]);
    expect(() => writeRecent("alpha", "u1")).not.toThrow();
  });

  it("answers empty for a corrupt entry rather than throwing", () => {
    globalThis.localStorage.setItem("dopl.search.recents:u1", "{not json");
    expect(readRecents("u1")).toEqual([]);
    globalThis.localStorage.setItem("dopl.search.recents:u1", '{"q":1}');
    expect(readRecents("u1")).toEqual([]);
  });
});
