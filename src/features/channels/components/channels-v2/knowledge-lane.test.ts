/**
 * THE KNOWLEDGE TAB'S WIRE CONTRACT — the three lane URLs, and what the tab
 * reads out of the payloads they answer with (Home Knowledge Panels M4).
 *
 * Two properties, and both of them fail SILENTLY in production:
 *
 *  - 🔒 **§8 STALE CACHE.** These payloads land in the SAME IndexedDB-persisted
 *    query cache as everything else (24h `gcTime`), so the first paint after any
 *    upgrade can restore an entry a previous bundle wrote. A sibling key read
 *    straight through (`body.bases.map`) THROWS and blanks the panel — the exact
 *    class of bug that shipped twice on 2026-08-25. Every case below deletes the
 *    key rather than emptying it, because `[]` is the state that already works.
 *  - 🔒 **THE PEN FOLLOWS THE SERVER'S OWN FLAG.** `canEditGranted` reads
 *    `grant.guestWrite`, which is what `assertGrantWritable` reads; anything
 *    looser draws an Edit button whose save comes back 403
 *    (`CHANNEL_GRANT_READ_ONLY`), which is the one thing §5.5 forbids.
 *
 * ⚠ MUTATION-VERIFY: drop any `?? EMPTY_X` in `knowledge-lane.ts` and the
 * matching key-deleted case throws; loosen `canEditGranted` to
 * `grants[baseId] !== undefined` and the `agent_only`/read-only cases go red.
 */

import { describe, expect, it } from "vitest";
import {
  EMPTY_BASES,
  EMPTY_ENTRIES,
  EMPTY_FOLDERS,
  EMPTY_GRANTS,
  canEditGranted,
  channelKnowledgeBasesPath,
  channelKnowledgeEntryPath,
  channelKnowledgeKeys,
  channelKnowledgeTreePath,
  selectGrantedBases,
  selectTree,
} from "./knowledge-lane";
import type { KnowledgeBase } from "@/features/knowledge/types";

const CHANNEL = "44444444-4444-4444-8444-444444444444";
const BASE = "55555555-5555-4555-8555-555555555555";

const base = { id: BASE, name: "Handbook" } as KnowledgeBase;

describe("the lane's URLs", () => {
  it("addresses the CHANNEL lane and never the workspace knowledge routes", () => {
    // The whole reason one component can serve a guest: every path is under
    // `/api/channels/{id}/knowledge/**`, which is guest-floored + grant-gated.
    // `/api/knowledge/**` is at the viewer default and 403s a guest.
    for (const path of [
      channelKnowledgeBasesPath(CHANNEL),
      channelKnowledgeTreePath(CHANNEL, BASE),
      channelKnowledgeEntryPath(CHANNEL, "e-1"),
    ]) {
      expect(path.startsWith(`/api/channels/${CHANNEL}/knowledge/`)).toBe(true);
    }
  });

  it("encodes the ids it is handed", () => {
    expect(channelKnowledgeEntryPath(CHANNEL, "a/b")).toContain("a%2Fb");
    expect(channelKnowledgeTreePath(CHANNEL, "a b")).toContain("a%20b");
  });

  it("builds every cache key from the path the read uses", () => {
    // A key that drifts by one element is a silent no-op (INVARIANTS §8): the
    // entry PUT patches the entry GET's entry, or it patches nothing.
    expect(channelKnowledgeKeys.entry(CHANNEL, "e-1").all).toEqual([
      channelKnowledgeEntryPath(CHANNEL, "e-1"),
    ]);
    expect(channelKnowledgeKeys.tree(CHANNEL, BASE).all).toEqual([
      channelKnowledgeTreePath(CHANNEL, BASE),
    ]);
    expect(channelKnowledgeKeys.bases(CHANNEL).all).toEqual([
      channelKnowledgeBasesPath(CHANNEL),
    ]);
  });
});

describe("§8 stale cache — a payload cached before this lane existed", () => {
  it("reads the base list with BOTH sibling keys absent", () => {
    // Not `{bases: [], grants: {}}` — the KEYS ARE GONE, which is the shape a
    // pre-M2 cache entry has and the shape that throws when read through.
    const read = selectGrantedBases({});
    expect(read.bases).toBe(EMPTY_BASES);
    expect(read.grants).toBe(EMPTY_GRANTS);
    // Absent reads as "nothing is shared here" — the fail-safe direction for an
    // AUDIENCE list, and it renders as the tab's empty state, not as a blank.
    expect(read.bases.length).toBe(0);
  });

  it("keeps the bases when only `grants` is missing — the tab still lists, read-only", () => {
    const read = selectGrantedBases({ bases: [base] });
    expect(read.bases).toEqual([base]);
    expect(canEditGranted(read.grants, BASE)).toBe(false);
  });

  it("reads a tree with `folders` and `entries` absent", () => {
    const read = selectTree({ base });
    expect(read.base).toBe(base);
    expect(read.folders).toBe(EMPTY_FOLDERS);
    expect(read.entries).toBe(EMPTY_ENTRIES);
  });

  it("reads a tree with NO `base` as a failed read, not a nameless base", () => {
    // ⚠ `base` is the payload's SUBJECT. Defaulting it would draw a knowledge
    // base with no name over a read that did not happen.
    expect(selectTree({}).base).toBeNull();
  });

  it("hands back the SAME frozen empties every time — a fresh [] churns memos", () => {
    expect(selectGrantedBases({}).bases).toBe(selectGrantedBases({}).bases);
    expect(Object.isFrozen(EMPTY_BASES)).toBe(true);
    expect(Object.isFrozen(EMPTY_GRANTS)).toBe(true);
  });
});

describe("who may edit — the server's own flag, read once", () => {
  it("allows the edit only at `guestWrite: true`", () => {
    expect(
      canEditGranted({ [BASE]: { level: "visible", guestWrite: true } }, BASE)
    ).toBe(true);
  });

  it("refuses a `visible` grant WITHOUT guest write — the 403 the tab must not earn", () => {
    expect(
      canEditGranted({ [BASE]: { level: "visible", guestWrite: false } }, BASE)
    ).toBe(false);
  });

  it("refuses an ABSENT grant rather than falling open", () => {
    // The degraded case (a base listed without its grant row). Fail-safe is no
    // pen — never "we could not tell, so allow it".
    expect(canEditGranted({}, BASE)).toBe(false);
    expect(canEditGranted(EMPTY_GRANTS, BASE)).toBe(false);
  });

  it("reads `guestWrite` ALONE — the LEVEL is not this question", () => {
    // ⚠ Deliberately NOT `level === "visible" && guestWrite`. The lane filters
    // `agent_only` out in SQL, so a row at that level cannot reach this map; a
    // second condition here would be a rule with no test data behind it,
    // shadowing the one that actually gates the PUT. The server asks exactly
    // one question on the write path and so does this.
    expect(
      canEditGranted({ [BASE]: { level: "agent_only", guestWrite: true } }, BASE)
    ).toBe(true);
    expect(
      canEditGranted({ [BASE]: { level: "agent_only", guestWrite: false } }, BASE)
    ).toBe(false);
  });
});
