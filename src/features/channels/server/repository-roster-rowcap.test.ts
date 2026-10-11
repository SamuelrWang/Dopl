/**
 * 🔒 **THE THREE `channel_members` READS THE SWEEP LEFT UNPAGED (Samuel #2935, the
 * review).** `memberCounts` was paged and `repository-collab.ts ›
 * channelMemberUserIds` was paged — both to a 10,000 ceiling, **which is this
 * codebase's own statement that rosters this size are expected** — while the three
 * reads here stayed single statements and were therefore clipped at `max_rows` =
 * 1,000, server-side, with no error:
 *
 *   1. **`listMembers`** — ONE channel's whole roster, and its consumers include
 *      ADDRESSING (`service-writes-metadata-recipient.ts` resolves an `@`-tag
 *      against this list; `service-writes-metadata.ts` fans notifications over
 *      it). On a channel past a thousand members a real member read as "no such
 *      recipient" rather than as an error.
 *   2. **`countOwners`** — a haul-and-fold (`select("user_id") … .length`) with NO
 *      bound at all, backing the LAST-OWNER-LEAVE guard. A clip can only
 *      UNDER-count, which is the one direction that matters: the guard failed
 *      OPEN and admitted the last owner's departure.
 *   3. **`listMyMemberships`** — the user's whole channel list, built from a
 *      partial membership set.
 *
 * ⚠ **`countOwners`' FIX IS A SHAPE CHANGE, NOT A WALK.** `max_rows` bounds the
 * response BODY and never the `Content-Range` total, so `head: true` + `count:
 * "exact"` is IMMUNE to this whole class of bug — the sanctioned shape
 * (`analytics/server/health.ts › getMcpHealth`). ⚠ `shared/testing/postgrest-cap.ts`
 * leaves `count` exact and unclipped for exactly this reason, so the case below
 * distinguishes the two shapes rather than flattering either.
 *
 * ⚠ **THE FAKE APPLIES THE CEILING RATHER THAN RECORDING IT** (INVARIANTS §14),
 * `MAX_ROWS` read out of `supabase/config.toml`. `memberCounts` keeps its own
 * suite (`repository-members-rowcap.test.ts`).
 *
 * MUTATION-VERIFY (each reverted alone turns the named case red):
 *  - un-page `listMembers` → "every one of 1,500 members" and the page-shape case
 *    fail.
 *  - drop `.order("user_id")` from it → "the roster order is TOTAL" fails.
 *  - put `select("user_id") … .length` back in `countOwners` → "counts 1,200
 *    owners" and "asks for a COUNT and no rows" fail.
 *  - un-page `listMyMemberships` → "every one of 1,500 memberships" fails.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/shared/supabase/admin", () => ({ supabaseAdmin: vi.fn() }));

import { supabaseAdmin } from "@/shared/supabase/admin";
import {
  MAX_ROWS,
  fakePostgrest,
  type FakePostgrest,
  type Row,
} from "@/shared/testing/postgrest-cap";
import {
  countOwners,
  listMembers,
  listMyMemberships,
} from "./repository-members";

const WS = "11111111-2222-4333-8444-555555555555";
const CH = "22222222-3333-4444-8555-666666666666";
const OTHER_CH = "33333333-4444-4555-8666-777777777777";
const ME = "99999999-8888-4777-8666-555555555555";

/** ⚠ Past `max_rows`, inside the 10,000 hard cap: these cases prove the WALK. */
const ROSTER = 1_500;
const OWNERS = 1_200;

const pad = (n: number) => String(n).padStart(7, "0");
const userId = (n: number) => `u-${pad(n)}`;

/**
 * `n` members of `channel`. ⚠ **EVERY ROW SHARES ONE `joined_at` ON PURPOSE** —
 * that is what a bulk add actually writes (the column's default is `now()`), and
 * it is why the display order alone cannot page: only the `user_id` tie-break
 * makes `(joined_at, user_id)` unique inside one channel's result.
 */
function members(n: number, channel = CH, from = 0): Row[] {
  return Array.from({ length: n }, (_, i) => ({
    channel_id: channel,
    user_id: userId(from + i),
    workspace_id: WS,
    role: "member",
    joined_at: "2026-09-02T00:00:00.000Z",
    last_read_at: null,
    added_by: null,
  }));
}

/** `n` channels `ME` belongs to — {@link listMyMemberships}' shape. */
function myMemberships(n: number): Row[] {
  return Array.from({ length: n }, (_, i) => ({
    channel_id: `ch-${pad(i)}`,
    user_id: ME,
    workspace_id: WS,
    role: "member",
    joined_at: "2026-09-02T00:00:00.000Z",
    last_read_at: null,
    added_by: null,
  }));
}

function mount(rows: Row[]): FakePostgrest {
  const fake = fakePostgrest({ channel_members: rows });
  vi.mocked(supabaseAdmin).mockReturnValue(fake.client as never);
  return fake;
}

function orderedColumns(fake: FakePostgrest): string[] {
  return [
    ...new Set(
      fake.calls.filter((c) => c.op === "order").map((c) => String(c.args[0]))
    ),
  ];
}

function ranges(fake: FakePostgrest): number[][] {
  return fake.calls
    .filter((c) => c.op === "range")
    .map((c) => [Number(c.args[0]), Number(c.args[1])]);
}

function tupleCount(rows: readonly Row[], cols: readonly string[]): number {
  return new Set(rows.map((r) => cols.map((c) => String(r[c])).join("\u0000")))
    .size;
}

/** The fake's builder, typed just enough to spell THE SHAPE THESE READS REPLACED. */
interface Unlimited {
  from: (table: string) => Unlimited;
  select: (cols: string) => Unlimited;
  eq: (col: string, value: unknown) => Unlimited;
  order: (col: string, opts?: { ascending?: boolean }) => Unlimited;
  then: (resolve: (r: { data: Row[]; error: unknown }) => void) => void;
}
const unlimited = (client: unknown) => client as unknown as Unlimited;

const read = (client: unknown, build: (q: Unlimited) => Unlimited) =>
  new Promise<{ data: Row[]; error: unknown }>((resolve) =>
    build(unlimited(client)).then(resolve)
  );

beforeEach(() => {
  vi.clearAllMocks();
});

describe("listMembers — one channel's roster past the PostgREST ceiling", () => {
  /** 🔒 **THE CONTROL, AND WITHOUT IT EVERY CASE BELOW PROVES NOTHING.** The old
   *  shape asked for NO bound and the server imposed one anyway — which is the
   *  half of this bug that reads as a non-bug in review. */
  it(`⚠ the old UNLIMITED select comes back as exactly ${MAX_ROWS}, silently`, async () => {
    expect(ROSTER).toBeGreaterThan(MAX_ROWS);
    const { client } = mount(members(ROSTER));

    const { data, error } = await read(client, (q) =>
      q
        .from("channel_members")
        .select("*")
        .eq("channel_id", CH)
        .order("joined_at", { ascending: true })
    );

    expect(error).toBeNull();
    expect(data).toHaveLength(MAX_ROWS);
  });

  /** ⚠ **THE ID SET, NOT THE LENGTH.** A length is blind to the failure paging
   *  actually produces: one member twice and another never. */
  it(`sees every one of ${ROSTER} members, once each and none missing`, async () => {
    mount(members(ROSTER));

    const rows = await listMembers(CH);

    const ids = rows.map((r) => r.user_id);
    expect(ids).toHaveLength(ROSTER);
    expect(new Set(ids).size).toBe(ROSTER);
    expect([...ids].sort()).toEqual(
      members(ROSTER)
        .map((r) => String(r.user_id))
        .sort()
    );
  });

  /** 🔒 **RECIPIENT RESOLUTION IS THE CONSUMER THAT MADE THIS SHARP.** An `@`-tag
   *  is matched against this list, so the member whose row sorts LAST read as "no
   *  such recipient" on a channel past a thousand people — a refusal, not an
   *  error, which is why nobody filed it as one. */
  it("carries the member whose row sorts LAST — what addressing resolves against", async () => {
    mount(members(ROSTER));

    const rows = await listMembers(CH);

    const last = userId(ROSTER - 1);
    expect(rows.some((r) => r.user_id === last)).toBe(true);
    // ⚠ And it is reachable the way the recipient resolver reaches it.
    expect(new Map(rows.map((r) => [r.user_id, r])).get(last)).toBeDefined();
  });

  it("walks TWO contiguous pages of the server's own ceiling, not one hopeful ask", async () => {
    const fake = mount(members(ROSTER));

    await listMembers(CH);

    expect(fake.pageReads()).toBe(2);
    const seen = ranges(fake);
    expect(seen).toEqual([
      [0, MAX_ROWS - 1],
      [MAX_ROWS, 2 * MAX_ROWS - 1],
    ]);
    // ⚠ No page wider than the ceiling — the walk's ONLY exhaustion signal.
    expect(seen.every(([from, to]) => to - from + 1 <= MAX_ROWS)).toBe(true);
  });

  /**
   * 🔒 **`joined_at` IS NOT UNIQUE AND THAT IS NOT A FIXTURE QUIRK** — a bulk add
   * writes one `now()` across every row. Paging a non-unique ORDER BY lets
   * Postgres return one row twice and skip another, so the display order is kept
   * and `user_id` is APPENDED: `(channel_id, user_id)` is the PRIMARY KEY and
   * `channel_id` is pinned by the `eq`, which makes the pair unique here.
   */
  it("the roster order is TOTAL — and its `joined_at` prefix is not", async () => {
    const seeded = members(1_200);
    const fake = mount(seeded);

    await listMembers(CH);

    const cols = orderedColumns(fake);
    expect(cols).toEqual(["joined_at", "user_id"]);
    expect(tupleCount(seeded, cols)).toBe(seeded.length);
    expect(tupleCount(seeded, ["joined_at"])).toBe(1);
  });

  it("keeps the channel fence on EVERY page, and no other channel's members", async () => {
    const fake = mount([
      ...members(1_100, CH),
      ...members(1_200, OTHER_CH, 40_000),
    ]);

    const rows = await listMembers(CH);

    expect(rows).toHaveLength(1_100);
    expect(rows.every((r) => r.channel_id === CH)).toBe(true);
    const eqs = fake.calls.filter((c) => c.op === "eq").map((c) => c.args);
    expect(eqs).toHaveLength(2);
    expect(eqs.every((a) => a[0] === "channel_id" && a[1] === CH)).toBe(true);
  });

  it("an empty channel is a complete answer in one read", async () => {
    const fake = mount([]);
    expect(await listMembers(CH)).toEqual([]);
    expect(fake.pageReads()).toBe(1);
  });

  it("propagates a page error rather than reporting a short roster", async () => {
    const client: Record<string, unknown> = {};
    Object.assign(client, {
      from: () => client,
      select: () => client,
      eq: () => client,
      order: () => client,
      range: () => client,
      then: (resolve: (r: unknown) => void) =>
        resolve({ data: null, error: { code: "42501", message: "denied" } }),
    });
    vi.mocked(supabaseAdmin).mockReturnValue(client as never);

    await expect(listMembers(CH)).rejects.toMatchObject({ code: "42501" });
  });
});

describe("countOwners — the last-owner guard's number", () => {
  /** 🔒 **THE CONTROL: THE OLD HAUL-AND-FOLD, CLIPPED.** `.length` over a clipped
   *  body is an UNDER-count, and an under-count here admits the last owner's
   *  departure — the guard failing OPEN. */
  it(`⚠ a hauled-and-folded owner list reads ${MAX_ROWS} of ${OWNERS}`, async () => {
    expect(OWNERS).toBeGreaterThan(MAX_ROWS);
    const { client } = mount(
      members(OWNERS).map((r) => ({ ...r, role: "owner" }))
    );

    const { data } = await read(client, (q) =>
      q
        .from("channel_members")
        .select("user_id")
        .eq("channel_id", CH)
        .eq("role", "owner")
    );

    expect((data ?? []).length).toBe(MAX_ROWS);
    expect((data ?? []).length).toBeLessThan(OWNERS);
  });

  it(`counts ${OWNERS} owners exactly — a COUNT has no row to clip`, async () => {
    mount(members(OWNERS).map((r) => ({ ...r, role: "owner" })));

    expect(await countOwners(CH)).toBe(OWNERS);
  });

  /** ⚠ **THE SHAPE IS THE FIX**, so the shape is asserted: `head: true` carries no
   *  rows at all, which is what makes the answer immune to `max_rows`. */
  it("asks for a COUNT and no rows", async () => {
    const fake = mount(members(5).map((r) => ({ ...r, role: "owner" })));

    await countOwners(CH);

    const select = fake.calls.find((c) => c.op === "select");
    expect(select?.args[1]).toEqual({ count: "exact", head: true });
  });

  it("counts only THIS channel's owners, and no member", async () => {
    mount([
      ...members(900, CH).map((r) => ({ ...r, role: "owner" })),
      ...members(600, CH, 10_000),
      ...members(900, OTHER_CH, 20_000).map((r) => ({ ...r, role: "owner" })),
    ]);

    expect(await countOwners(CH)).toBe(900);
  });

  it("an ownerless channel is 0, and an unreadable one still throws", async () => {
    mount(members(3));
    expect(await countOwners(CH)).toBe(0);

    const client: Record<string, unknown> = {};
    Object.assign(client, {
      from: () => client,
      select: () => client,
      eq: () => client,
      then: (resolve: (r: unknown) => void) =>
        resolve({ data: null, count: null, error: { code: "42501" } }),
    });
    vi.mocked(supabaseAdmin).mockReturnValue(client as never);
    // ⚠ UNREADABLE must never read as "no owners" — that is the guard failing open.
    await expect(countOwners(CH)).rejects.toMatchObject({ code: "42501" });
  });
});

describe("listMyMemberships — the caller's whole channel list", () => {
  it(`⚠ the old UNLIMITED select comes back as exactly ${MAX_ROWS}`, async () => {
    const { client } = mount(myMemberships(ROSTER));

    const { data } = await read(client, (q) =>
      q
        .from("channel_members")
        .select("*")
        .eq("workspace_id", WS)
        .eq("user_id", ME)
    );

    expect(data).toHaveLength(MAX_ROWS);
  });

  it(`carries every one of ${ROSTER} memberships, once each`, async () => {
    mount(myMemberships(ROSTER));

    const rows = await listMyMemberships(WS, ME);

    const ids = rows.map((r) => r.channel_id);
    expect(ids).toHaveLength(ROSTER);
    expect(new Set(ids).size).toBe(ROSTER);
    expect(ids).toContain(`ch-${pad(ROSTER - 1)}`);
  });

  /** ⚠ `PRIMARY KEY (channel_id, user_id)` with `user_id` pinned by the `eq`
   *  leaves `channel_id` unique WITHIN this result — which is the whole
   *  requirement a page walk has. */
  it("the order is TOTAL within the fence — `channel_id`", async () => {
    const seeded = myMemberships(1_200);
    const fake = mount(seeded);

    await listMyMemberships(WS, ME);

    expect(orderedColumns(fake)).toEqual(["channel_id"]);
    expect(tupleCount(seeded, ["channel_id"])).toBe(seeded.length);
    expect(tupleCount(seeded, ["user_id"])).toBe(1);
  });

  it("holds BOTH fences on every page", async () => {
    const fake = mount([
      ...myMemberships(1_100),
      // ⚠ Neither may be carried: somebody else's membership, another container's.
      ...myMemberships(300).map((r, i) => ({
        ...r,
        channel_id: `other-${pad(i)}`,
        user_id: "someone-else",
      })),
      ...myMemberships(300).map((r, i) => ({
        ...r,
        channel_id: `ws2-${pad(i)}`,
        workspace_id: "other-ws",
      })),
    ]);

    expect(await listMyMemberships(WS, ME)).toHaveLength(1_100);
    const eqs = fake.calls.filter((c) => c.op === "eq").map((c) => c.args[0]);
    expect(eqs).toEqual(["workspace_id", "user_id", "workspace_id", "user_id"]);
  });
});
