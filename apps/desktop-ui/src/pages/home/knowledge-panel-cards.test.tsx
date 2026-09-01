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

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
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
  sharedBaseIds: [],
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

/**
 * 🔒 THE /home CARD RESTYLE IS SCOPED BY A DEFAULTED ALIAS, AND BOTH HALVES OF
 * THAT HAVE TO HOLD (Samuel, 2026-08-28: three cards per row, title not bold and
 * sized off the channel row).
 *
 * ⚠ SOURCE READ, for the reason `agent-templates/components/template-editor.
 * test.tsx › no concave surfaces` states: jsdom loads no stylesheet and CSS
 * modules arrive as opaque class names, so the only honest place to pin a CSS
 * RULING is the declaration text. Paths resolve off `import.meta.url`, not
 * `process.cwd()` — this suite is run with `--root apps/desktop-ui` and reaches
 * into the repo-root web tree.
 *
 * ⚠ THE SECOND ASSERTION IS THE ONE THAT KEEPS IT /home-ONLY. The card is
 * `knowledge-v2/home/base-card.tsx`, shared with the workspace knowledge page
 * and never forked; the restyle is legitimate only while the shared rule keeps
 * a FALLBACK equal to that page's old value. Drop the fallback and the
 * workspace grid silently inherits /home's face — which is the exact failure
 * the alias was chosen to avoid, and it would show up on no /home test at all.
 */
describe("the /home card face is a rebind, not a fork", () => {
  const read = (rel: string) =>
    readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
  const homeCss = read("./home.module.css");
  const cardCss = read(
    "../../../../../src/features/knowledge/components/knowledge-v2/knowledge-v2.module.css"
  );
  /** `.kbCards`'s own block — the aliases below must be rebound THERE, not
   *  loose in the file where they would reach the whole page. */
  const kbCards = homeCss.slice(
    homeCss.indexOf(".kbCards {"),
    homeCss.indexOf("}", homeCss.indexOf(".kbCards {"))
  );

  it("🔒 /home's grid is THREE columns", () => {
    expect(kbCards).toMatch(/grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\)/);
  });

  it("🔒 rebinds the card's clamp on the GRID — and NOT its title", () => {
    expect(kbCards).toMatch(/--kv-card-desc-lines:\s*2/);
    // 🔒 THE TITLE REBINDS ARE GONE (Samuel, 2026-09-01). A KB card's name
    // matches the channel-row title EXACTLY on EVERY surface now, so the match
    // lives in `.cardName`'s own defaults (pinned below) — and a rebind here
    // could only make /home disagree with it again.
    expect(kbCards).not.toContain("--kv-card-title-size");
    expect(kbCards).not.toContain("--kv-card-title-weight");
  });

  /**
   * 🔒 **THE CARD NAME IS THE CHANNEL-ROW NAME, TOKEN FOR TOKEN.** The one
   * reference is `relationship-list.tsx › RelationshipRow`'s name span,
   * `truncate text-body font-medium text-text-primary` — so the defaults are
   * `--text-body` (the token behind `text-body`, never a literal `12.5px`, which
   * would be the same pixel today and a drift the day the ramp moves), weight
   * 500, and `--kv-text`, which resolves to `--text-primary` in both hosts.
   * ⚠ AND NO TRACKING: the card carried `letter-spacing: -0.01em` and the row
   * carries none — at 12.5px that is the difference between two words that look
   * set in different faces.
   */
  it("🔒 the SHARED card's defaults ARE the channel row's face", () => {
    expect(cardCss).toContain("var(--kv-card-title-size, var(--text-body))");
    expect(cardCss).toContain("var(--kv-card-title-weight, 500)");
    const cardName = cardCss.slice(
      cardCss.indexOf(".cardName {"),
      cardCss.indexOf("}", cardCss.indexOf(".cardName {"))
    );
    expect(cardName).not.toContain("letter-spacing");
    // The row it must match, read from ITS source — so this fails if EITHER
    // side moves, which is the half that matters.
    const row = read("./relationship-list.tsx");
    expect(row).toContain('"truncate text-body font-medium"');
    // Floor and cap read ONE number, or the row reserves lines it cannot draw.
    expect(cardCss).toContain("-webkit-line-clamp: var(--kv-card-desc-lines, 3)");
    expect(cardCss).toContain(
      "calc(var(--text-caption) * 1.45 * var(--kv-card-desc-lines, 3))"
    );
  });

  it("🔒 the workspace page's own grid is untouched — still its own 3 × 244px", () => {
    // The ruling was /home-scoped. `.cardGrid` is the knowledge PAGE's grid and
    // no /home change may reach it.
    expect(cardCss).toMatch(
      /\.cardGrid \{[^}]*grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\)[^}]*grid-auto-rows:\s*244px/
    );
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
