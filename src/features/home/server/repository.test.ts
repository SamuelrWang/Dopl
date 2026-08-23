/**
 * `findPairContainer` — THE DEDUP, and the reason it is one query.
 *
 * It used to derive the answer from `listLinkContainers`, which is capped: a
 * pair whose container sat past the cap read as "no container", and the claim
 * minted a SECOND one for a pair that already had one — two cards for the same
 * person, forever, with the transcript split across them. So what is pinned
 * here is that the intersection happens in the DATABASE, over every row.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/shared/supabase/admin", () => ({ supabaseAdmin: vi.fn() }));

import { supabaseAdmin } from "@/shared/supabase/admin";
import { findPairContainer } from "./repository";

const A = "aaaaaaaa-1111-4111-8111-111111111111";
const B = "bbbbbbbb-2222-4222-8222-222222222222";

interface Recorded {
  tables: string[];
  select: string;
  filters: Array<[string, unknown]>;
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
  rec = { tables: [], select: "", filters: [], limit: null };
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
    // straight into the relationship DTO.
    expect(await findPairContainer(A, B)).toEqual({
      id: "ws-1",
      slug: "ada-grace",
      public_id: "abc123def456",
      created_at: "2026-08-23T00:00:00.000Z",
    });
  });
});
