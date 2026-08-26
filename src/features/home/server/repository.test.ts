/**
 * The three home reads whose QUERY SHAPE is the correctness argument, pinned by
 * recording what each one asks the database for:
 *
 *  - `findPairContainer` — THE DEDUP, and the reason it is one query. It used to
 *    derive the answer from `listLinkContainers`, which is capped: a pair whose
 *    container sat past the cap read as "no container", and the claim minted a
 *    SECOND one for a pair that already had one — two cards for the same person,
 *    forever, with the transcript split across them. So what is pinned is that
 *    the intersection happens in the DATABASE, over every row.
 *  - `listContainerChannels` — the two filters it must NOT carry.
 *  - `listLinksByWorkspaces` — the chip read: bounded, named columns.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/shared/supabase/admin", () => ({ supabaseAdmin: vi.fn() }));

import { supabaseAdmin } from "@/shared/supabase/admin";
import {
  findPairContainer,
  listContainerChannels,
  listLinksByWorkspaces,
} from "./repository";

const A = "aaaaaaaa-1111-4111-8111-111111111111";
const B = "bbbbbbbb-2222-4222-8222-222222222222";
const WS = "cccccccc-3333-4333-8333-333333333333";

interface Recorded {
  tables: string[];
  select: string;
  /** `.eq()`, `.is()` and `.in()` alike — every narrowing this query applies. */
  filters: Array<[string, unknown]>;
  order: Array<[string, boolean | undefined]>;
  limit: number | null;
}

let rec: Recorded;

function primeSupabase(rows: unknown[]) {
  const builder: Record<string, unknown> = {};
  Object.assign(builder, {
    from: (t: string) => {
      rec.tables.push(t);
      return builder;
    },
    select: (cols: string) => {
      rec.select = cols;
      return builder;
    },
    eq: (col: string, val: unknown) => {
      rec.filters.push([col, val]);
      return builder;
    },
    is: (col: string, val: unknown) => {
      rec.filters.push([col, val]);
      return builder;
    },
    in: (col: string, val: unknown) => {
      rec.filters.push([col, val]);
      return builder;
    },
    order: (col: string, opts?: { ascending?: boolean }) => {
      rec.order.push([col, opts?.ascending]);
      return builder;
    },
    limit: (n: number) => {
      rec.limit = n;
      return builder;
    },
    then: (resolve: (r: unknown) => void) => resolve({ data: rows, error: null }),
  });
  vi.mocked(supabaseAdmin).mockReturnValue(builder as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  rec = { tables: [], select: "", filters: [], order: [], limit: null };
});

describe("findPairContainer", () => {
  it("asks the database for a container BOTH are active in, in one bounded read", async () => {
    primeSupabase([]);
    expect(await findPairContainer(A, B)).toBeNull();

    // ⚠ ONE table, and it is `workspaces` — not a listing of A's containers
    // narrowed afterwards, which is what could miss past the list's cap.
    expect(rec.tables).toEqual(["workspaces"]);
    expect(rec.select).toContain("a:workspace_members!inner");
    expect(rec.select).toContain("b:workspace_members!inner");
    // Both memberships AND'd in the query, plus the kind fence.
    expect(rec.filters).toEqual([
      ["kind", "link"],
      ["a.user_id", A],
      ["a.status", "active"],
      ["b.user_id", B],
      ["b.status", "active"],
    ]);
    // Bounded: a pair has at most one container.
    expect(rec.limit).toBe(1);
  });

  it("returns the container's own columns, never the joined membership rows", async () => {
    primeSupabase([
      {
        id: "ws-1",
        slug: "ada-grace",
        public_id: "abc123def456",
        created_at: "2026-08-23T00:00:00.000Z",
        a: [{ user_id: A }],
        b: [{ user_id: B }],
      },
    ]);

    // The embeds are a FILTER, not payload — a leaked `a`/`b` would flow
    // straight into the channel DTO.
    expect(await findPairContainer(A, B)).toEqual({
      id: "ws-1",
      slug: "ada-grace",
      public_id: "abc123def456",
      created_at: "2026-08-23T00:00:00.000Z",
    });
  });
});

describe("listContainerChannels", () => {
  it("does NOT filter on is_direct — a solo channel is not a DM", async () => {
    primeSupabase([]);
    await listContainerChannels([WS]);

    // ⚠ `.eq("is_direct", true)` was here until 2026-08-24. A container minted
    // by "New channel" holds a PRIVATE NON-DIRECT channel, so that filter
    // dropped every solo channel off the page.
    expect(rec.filters.map(([col]) => col)).not.toContain("is_direct");
    expect(rec.filters).toEqual([["workspace_id", [WS]]]);
  });

  it("does NOT filter on deleted_at — a closed DM is still the container's channel", async () => {
    primeSupabase([]);
    await listContainerChannels([WS]);

    // A DM soft-delete is the close half of close/reopen; filtering here would
    // drop the whole channel off the page instead of letting the desktop revive
    // it on the next open.
    expect(rec.filters.map(([col]) => col)).not.toContain("deleted_at");
  });

  it("takes the OLDEST channel per container, and carries its name", async () => {
    primeSupabase([
      { id: "chan-old", workspace_id: WS, name: "Fundraise" },
      { id: "chan-new", workspace_id: WS, name: "Later" },
    ]);

    const map = await listContainerChannels([WS]);

    expect(rec.order).toEqual([["created_at", true]]);
    expect(map.get(WS)).toEqual({ id: "chan-old", name: "Fundraise" });
  });

  it("short-circuits on an empty id list rather than asking for everything", async () => {
    primeSupabase([]);
    expect((await listContainerChannels([])).size).toBe(0);
    expect(rec.tables).toEqual([]);
  });
});

describe("listLinksByWorkspaces", () => {
  it("is bounded and selects NAMED COLUMNS, never a star", async () => {
    primeSupabase([]);
    await listLinksByWorkspaces([WS], 200);

    expect(rec.tables).toEqual(["channel_links"]);
    expect(rec.select).not.toBe("*");
    expect(rec.select).toContain("workspace_id");
    expect(rec.select).toContain("token");
    expect(rec.filters).toEqual([
      ["workspace_id", [WS]],
      ["revoked_at", null],
    ]);
    expect(rec.limit).toBe(200);
  });

  it("keys the first open link per container", async () => {
    primeSupabase([
      { id: "link-1", workspace_id: WS },
      { id: "link-2", workspace_id: WS },
    ]);
    expect((await listLinksByWorkspaces([WS], 200)).get(WS)?.id).toBe("link-1");
  });

  it("short-circuits on an empty id list", async () => {
    primeSupabase([]);
    expect((await listLinksByWorkspaces([], 200)).size).toBe(0);
    expect(rec.tables).toEqual([]);
  });
});
