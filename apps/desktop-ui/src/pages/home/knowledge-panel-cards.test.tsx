/**
 * 🔒 THE READER'S KEY AND THE WRITER'S PATCH TARGET ARE THE SAME KEY — the pin
 * that was missing while they were two different shapes.
 *
 * The grant write (`knowledge/client/hooks-channel-grants.ts ›
 * patchChannelGrantInCache`) walks every `["knowledge", …]` entry and matches
 * `key[1]` against `knowledgeBasesCacheSegment(ws, channelId)` — the
 * STRING-extended segment `"bases:W:channel:C"`. The /home pane mounted an
 * ARRAY-extended key, `["knowledge", "bases:W", "channel:C"]`, whose `key[1]` is
 * `"bases:W"`. So the patch reached nothing the pane had mounted: granting a
 * base from the settings modal did not move it between sections until a cold
 * refetch.
 *
 * ⚠ AND THE EXISTING SUITE PASSED, WHICH IS THE REAL FINDING. It seeded the
 * WRITER's shape and then asserted the writer had patched it. **A test that
 * mints its own key proves the patcher works and says nothing about whether
 * anybody is listening.** Every assertion below therefore starts from
 * `channelBasesQueryKey` — the function the PANE calls — and never from
 * `knowledgeBasesQueryKey` directly.
 *
 * ⚠ MUTATION-VERIFIED: restoring the array-extended shape in
 * `channelBasesQueryKey` turns both halves red. Count in the milestone report.
 */

import { QueryClient } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { KnowledgeBaseList } from "@/features/knowledge/client/api";
import {
  knowledgeBasesCacheSegment,
  knowledgeBasesQueryKey,
} from "@/features/knowledge/client/hooks";
import { patchChannelGrantInCache } from "@/features/knowledge/client/hooks-channel-grants";
import type { KnowledgeBase } from "@/features/knowledge/types";
import { BaseCell, channelBasesQueryKey } from "./knowledge-panel-cards";

const WS = "ws-container";
const CHANNEL = "chan-1";
const BASE = "kb-1";

function seededList(): KnowledgeBaseList {
  return {
    bases: [],
    ownerNames: {},
    baseStats: {},
    kbStorageLimit: null,
    starredBaseIds: [],
    channelGrants: {},
  };
}

describe("channelBasesQueryKey — the shape the writer matches on", () => {
  it("🔒 its `key[1]` IS the segment the grant patch targets", () => {
    // `hooks-channel-grants.ts` reads `key[1]` and compares it to this segment.
    // Anything else in that slot is a silent no-op (§8: a key off by one element).
    expect(channelBasesQueryKey(WS, CHANNEL)[1]).toBe(
      knowledgeBasesCacheSegment(WS, CHANNEL)
    );
  });

  it("is the shared minter's channel form, not a locally-built variant", () => {
    expect(channelBasesQueryKey(WS, CHANNEL)).toEqual(
      knowledgeBasesQueryKey(WS, CHANNEL)
    );
  });

  it("is still a DIFFERENT entry from the unscoped list", () => {
    // The scoped read folds in `channelGrants` that the unscoped one does not
    // send; sharing an entry would let an unscoped refetch blank them.
    expect(channelBasesQueryKey(WS, CHANNEL)).not.toEqual(
      knowledgeBasesQueryKey(WS)
    );
  });
});

describe("a grant write reaches the entry the PANE mounted", () => {
  it("🔒 patches the reader's own key — seeded from channelBasesQueryKey", () => {
    const client = new QueryClient();
    const readerKey = channelBasesQueryKey(WS, CHANNEL);
    client.setQueryData<KnowledgeBaseList>(readerKey, seededList());

    patchChannelGrantInCache(client, {
      workspaceId: WS,
      baseId: BASE,
      channelId: CHANNEL,
      grant: { level: "visible", guestWrite: false },
    });

    expect(
      client.getQueryData<KnowledgeBaseList>(readerKey)?.channelGrants[BASE]
    ).toEqual({ level: "visible", guestWrite: false });
  });

  it("removing a grant DELETES the key on that same entry, never stores a level", () => {
    const client = new QueryClient();
    const readerKey = channelBasesQueryKey(WS, CHANNEL);
    client.setQueryData<KnowledgeBaseList>(readerKey, {
      ...seededList(),
      channelGrants: { [BASE]: { level: "agent_only", guestWrite: false } },
    });

    patchChannelGrantInCache(client, {
      workspaceId: WS,
      baseId: BASE,
      channelId: CHANNEL,
      grant: null,
    });

    const after = client.getQueryData<KnowledgeBaseList>(readerKey);
    expect(after?.channelGrants).not.toHaveProperty(BASE);
  });

  it("leaves ANOTHER channel's entry alone", () => {
    const client = new QueryClient();
    const otherKey = channelBasesQueryKey(WS, "chan-other");
    client.setQueryData<KnowledgeBaseList>(otherKey, seededList());
    client.setQueryData<KnowledgeBaseList>(
      channelBasesQueryKey(WS, CHANNEL),
      seededList()
    );

    patchChannelGrantInCache(client, {
      workspaceId: WS,
      baseId: BASE,
      channelId: CHANNEL,
      grant: { level: "visible", guestWrite: false },
    });

    expect(
      client.getQueryData<KnowledgeBaseList>(otherKey)?.channelGrants
    ).toEqual({});
  });
});

describe("BaseCell — §8 stale cache, read out of the CACHE and not off the wire", () => {
  /**
   * 🔒 ⚠ `?.` GUARDS `list`, NOT THE SIBLING KEY. The cell read
   * `list?.ownerNames[base.createdBy]`, `list?.baseStats[base.id]` and
   * `list?.starredBaseIds.includes(base.id)`. Against a payload cached by a
   * bundle that predates a field, `list` is a live object whose key is
   * `undefined` — indexing reads `undefined` (bad) and `.includes()` THROWS
   * (worse: it blanks the whole pane, §8's named failure).
   *
   * ⚠ AND IT HAS TO BE PINNED HERE, NOT AT THE ROUTE. `client/api.ts ›
   * fetchBaseList` normalises every one of these keys on the WIRE, so a route
   * fixture with a key deleted can only ever exercise a pre-deploy SERVER. The
   * stale-CACHE payload never passes through today's `fetchBaseList` at all —
   * it is read straight out of the query cache, which is the object shape
   * below. `knowledge-panels.test.tsx`'s §8 block says the same thing from the
   * other side.
   *
   * ⚠ MUTATION-VERIFIED: restoring any of the three `?.`-only reads turns this
   * red — `starredBaseIds` by throwing, the other two by rendering wrong.
   */
  const BASE = {
    id: "kb-1",
    name: "Renewals",
    createdBy: "user-2",
    visibility: "public",
    workspaceId: WS,
  } as KnowledgeBase;

  /** A cache entry written before `ownerNames` / `baseStats` /
   *  `starredBaseIds` / `channelGrants` existed. ⚠ The keys are DELETED, not
   *  emptied — an empty object is what a CURRENT server sends. */
  function staleEntry(): KnowledgeBaseList {
    const stale: Record<string, unknown> = { bases: [BASE], kbStorageLimit: null };
    return stale as unknown as KnowledgeBaseList;
  }

  it("🔒 paints the card instead of throwing the pane away", () => {
    render(
      <BaseCell
        base={BASE}
        list={staleEntry()}
        badge={null}
        currentUserId="user-1"
        onOpen={() => {}}
        onToggleStar={() => {}}
      />
    );
    expect(screen.getByText("Renewals")).toBeInTheDocument();
  });

  it("a missing ownerNames degrades to the NEUTRAL label, never to 'You'", () => {
    // The base was created by somebody else; claiming the caller wrote it is a
    // worse answer than admitting the name lookup degraded.
    render(
      <BaseCell
        base={BASE}
        list={staleEntry()}
        badge={null}
        currentUserId="user-1"
        onOpen={() => {}}
        onToggleStar={() => {}}
      />
    );
    expect(screen.getByText(/Someone else/)).toBeInTheDocument();
    expect(screen.queryByText(/By You/)).not.toBeInTheDocument();
  });

  it("an ABSENT list (the other scope's read in flight) still paints", () => {
    // `undefined` is the case the `?.` was written for, and it must keep working.
    render(
      <BaseCell
        base={BASE}
        list={undefined}
        badge={null}
        currentUserId="user-1"
        onOpen={() => {}}
        onToggleStar={() => {}}
      />
    );
    expect(screen.getByText("Renewals")).toBeInTheDocument();
  });
});
