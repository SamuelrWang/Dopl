/**
 * 🔒 **THE TWO READS THAT ARE *FENCES*, PAST ONE POSTGREST PAGE (Samuel #2935,
 * the review of the `max_rows` sweep).**
 *
 * The sweep moved every read that is SUMMED into an aggregate and every read that
 * is LISTED into a page walk — and left the two reads that are neither alone,
 * because nothing renders them. Both were UNLIMITED selects, so
 * `supabase/config.toml › max_rows` answered the first 1,000 rows and raised
 * nothing, and both are consumed as a FENCE:
 *
 *   1. **`listWorkspaceChannelIds` IS `p_channel_ids`.** It is the rule-B arm of
 *      {@link readWorkspaceCreditBins}'s aggregate AND of the rails' tally AND the
 *      TS belt's `new Set(channelIds)`. So past a thousand channels the aggregate
 *      INHERITED, THROUGH ITS OWN FENCE, the exact clip it was written to remove:
 *      every burn in a dropped channel vanished from the series and both rails,
 *      and no marker could fire — an aggregate cannot report a clip on rows its
 *      argument never named.
 *   2. **`listWorkspaceRoles` IS THE BY-PERSON RAIL'S FENCE *AND* ITS GUEST
 *      MARKER** ("a person absent from this map is absent from that rail"). Past a
 *      thousand active members a payer was dropped from the rail and from name
 *      resolution at once, silently.
 *
 * ⚠ **THE FAKE APPLIES THE CEILING RATHER THAN RECORDING IT**
 * (`shared/testing/postgrest-cap.ts`, INVARIANTS §14), with `MAX_ROWS` read out of
 * `supabase/config.toml` rather than written beside it. The channel fixtures ride
 * `_fake-usage-db.ts › mount`, which already takes a channel list, so this suite
 * asserts against the SAME oversized month the other three do.
 *
 * MUTATION-VERIFY (each reverted alone turns the named case red):
 *  - drop the page walk from `listWorkspaceChannelIds` → "carries all 1,200
 *    channel ids" and "a burn in channel #1,100 reaches the series" fail.
 *  - drop `.order("id")` from it → "the channel order is TOTAL" fails.
 *  - drop the page walk from `listWorkspaceRoles` → "every one of 1,200 active
 *    members" and "the payer whose row sorts LAST" fail.
 *  - drop `.order("id")` from it → "the roster order is TOTAL" fails.
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
import type { Role } from "../types";
import { FOREIGN_WS, WS, burn, monthBins, mount } from "./_fake-usage-db";
import type { Args } from "./_fake-usage-db";
import { listWorkspaceChannelIds, listWorkspaceRoles } from "./repository-usage";
import { readWorkspaceCreditBins } from "./service-usage";

/** ⚠ 1,200 — PAST `max_rows` and inside the 10,000 hard cap, so what these cases
 *  prove is the walk rather than the cap. */
const CHANNELS = 1_200;
const MEMBERS = 1_200;

/** Zero-padded so the `id` order sorts the way a human reads it — the fake
 *  collates with `localeCompare`, exactly as Postgres collates `text`. */
const pad = (n: number) => String(n).padStart(5, "0");
const channelId = (n: number) => `ch-${pad(n)}`;
const memberId = (n: number) => `u-${pad(n)}`;

const CHANNEL_IDS = Array.from({ length: CHANNELS }, (_, i) => channelId(i));

/** 🔒 **THE CHANNEL THE OLD READ COULD NOT SEE** — the 1,100th, a hundred past
 *  the server's ceiling, so a burn fenced on it was dropped by the ARGUMENT. */
const DEEP_CHANNEL = channelId(1_099);

/** 🔒 **THE PAYER WHOSE ROSTER ROW SORTS LAST.** `guest` on purpose:
 *  `workspace_members` is the only table where that role exists, so this row is
 *  both the rail's fence and its guest marker — the two things one clip broke. */
const DEEP_MEMBER = memberId(MEMBERS - 1);

function memberRows(n: number, workspace = WS): Row[] {
  return Array.from({ length: n }, (_, i) => ({
    // ⚠ `workspace_members.id` is the PRIMARY KEY (a surrogate UUID;
    // `(workspace_id, user_id)` is merely UNIQUE) and the walk's total order.
    id: `wm-${pad(i)}`,
    workspace_id: workspace,
    user_id: memberId(i),
    role: i === n - 1 ? "guest" : i % 2 === 0 ? "member" : "admin",
    status: "active",
  }));
}

function mountRoster(rows: Row[]): FakePostgrest {
  const fake = fakePostgrest({ workspace_members: rows });
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

/** The fake's builder typed just enough to spell THE SHAPE THESE READS REPLACED.
 *  ⚠ The control cases exist to prove the harness clips a one-statement read;
 *  without a chain type they would be written through `never` casts, which is how
 *  a control stops compiling the thing it controls for. */
interface Unlimited {
  from: (table: string) => Unlimited;
  select: (cols: string) => Unlimited;
  eq: (col: string, value: unknown) => Unlimited;
  is: (col: string, value: unknown) => Unlimited;
  then: (resolve: (r: { data: Row[]; error: unknown }) => void) => void;
}
const unlimited = (client: unknown) => client as unknown as Unlimited;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("listWorkspaceChannelIds — the aggregates' own fence", () => {
  /** 🔒 **THE CONTROL, AND WITHOUT IT EVERY CASE BELOW PROVES NOTHING.** The OLD
   *  shape was an UNLIMITED select — no `.limit()` to decline — and the server
   *  clipped it anyway, which is the half of this bug that reads as a non-bug. */
  it(`⚠ the old UNLIMITED select comes back as exactly ${MAX_ROWS}, silently`, async () => {
    expect(CHANNELS).toBeGreaterThan(MAX_ROWS);
    const { client } = mount({ channels: CHANNEL_IDS });

    const { data, error } = await new Promise<{ data: Row[]; error: unknown }>(
      (resolve) =>
        unlimited(client)
          .from("channels")
          .select("id")
          .eq("workspace_id", WS)
          .is("deleted_at", null)
          .then(resolve)
    );

    expect(error).toBeNull();
    expect(data).toHaveLength(MAX_ROWS);
  });

  /** ⚠ **THE ID SET, NOT THE LENGTH.** A length is blind to the failure paging
   *  actually produces: one id twice and another never. */
  it(`carries all ${CHANNELS} channel ids, once each and none missing`, async () => {
    mount({ channels: CHANNEL_IDS });

    const ids = await listWorkspaceChannelIds(WS);

    expect(ids).toHaveLength(CHANNELS);
    expect(new Set(ids).size).toBe(CHANNELS);
    expect([...ids].sort()).toEqual([...CHANNEL_IDS].sort());
    expect(ids).toContain(DEEP_CHANNEL);
  });

  it(`hands the aggregate all ${CHANNELS} ids as p_channel_ids`, async () => {
    const { calls } = mount({ channels: CHANNEL_IDS });

    await readWorkspaceCreditBins(WS, monthBins());

    const args = calls.find((c) => c.op === "rpc")?.args[1] as Args;
    const passed = args.p_channel_ids as string[];
    expect(passed).toHaveLength(CHANNELS);
    expect([...passed].sort()).toEqual([...CHANNEL_IDS].sort());
  });

  /**
   * 🔒 **THE SYMPTOM, EXECUTABLE.** A rule-B arm-2 burn — THIS container's
   * channel, ANOTHER container's origin — is admitted by the channel arm and by
   * nothing else, so it counts if and only if its channel id reached the
   * argument. Under the clip, channel #1,100 was not in the list and this credit
   * simply was not on the plot.
   */
  it(`a burn in channel #1,100 reaches the series, which the clipped fence dropped`, async () => {
    mount({
      channels: CHANNEL_IDS,
      ledger: [
        burn({
          origin_workspace_id: FOREIGN_WS,
          channel_id: DEEP_CHANNEL,
          created_at: "2026-10-05T10:00:00.000Z",
        }),
      ],
    });

    const { counts } = await readWorkspaceCreditBins(WS, monthBins());

    // Oct 5 → bin index 4, and nowhere else.
    expect(counts[4]).toBe(1);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(1);
  });

  it("walks TWO contiguous pages of the server's own ceiling, not one hopeful ask", async () => {
    const fake = mount({ channels: CHANNEL_IDS });

    await listWorkspaceChannelIds(WS);

    const seen = ranges(fake);
    expect(seen).toEqual([
      [0, MAX_ROWS - 1],
      [MAX_ROWS, 2 * MAX_ROWS - 1],
    ]);
    // ⚠ No page wider than the ceiling — the walk's ONLY exhaustion signal.
    expect(seen.every(([from, to]) => to - from + 1 <= MAX_ROWS)).toBe(true);
  });

  /** ⚠ `channels.id` IS the primary key, so it is total by itself — and it is the
   *  projection as well, so the order costs nothing at all. */
  it("the channel order is TOTAL — `id`, and it is the only column read", async () => {
    const fake = mount({ channels: CHANNEL_IDS });

    await listWorkspaceChannelIds(WS);

    expect(orderedColumns(fake)).toEqual(["id"]);
    expect(fake.calls.find((c) => c.op === "select")?.args[0]).toBe("id");
  });

  it("keeps the container fence and the soft-delete filter on EVERY page", async () => {
    const fake = mount({ channels: CHANNEL_IDS });

    await listWorkspaceChannelIds(WS);

    const eqs = fake.calls.filter((c) => c.op === "eq").map((c) => c.args);
    expect(eqs).toHaveLength(2);
    expect(eqs.every((a) => a[0] === "workspace_id" && a[1] === WS)).toBe(true);
    const iss = fake.calls.filter((c) => c.op === "is").map((c) => c.args);
    expect(iss).toHaveLength(2);
    expect(iss.every((a) => a[0] === "deleted_at" && a[1] === null)).toBe(true);
  });

  it("an empty container is a complete answer in one read", async () => {
    const fake = mount({ channels: [] });
    expect(await listWorkspaceChannelIds(WS)).toEqual([]);
    expect(fake.pageReads()).toBe(1);
  });

  it("propagates a page error rather than reporting a short fence", async () => {
    const client: Record<string, unknown> = {};
    Object.assign(client, {
      from: () => client,
      select: () => client,
      eq: () => client,
      is: () => client,
      order: () => client,
      range: () => client,
      then: (resolve: (r: unknown) => void) =>
        resolve({ data: null, error: { code: "42501", message: "denied" } }),
    });
    vi.mocked(supabaseAdmin).mockReturnValue(client as never);

    await expect(listWorkspaceChannelIds(WS)).rejects.toMatchObject({
      code: "42501",
    });
  });
});

describe("listWorkspaceRoles — the by-person rail's fence and guest marker", () => {
  it(`⚠ the old UNLIMITED roster select comes back as exactly ${MAX_ROWS}`, async () => {
    expect(MEMBERS).toBeGreaterThan(MAX_ROWS);
    const { client } = mountRoster(memberRows(MEMBERS));

    const { data } = await new Promise<{ data: Row[]; error: unknown }>(
      (resolve) =>
        unlimited(client)
          .from("workspace_members")
          .select("user_id, role")
          .eq("workspace_id", WS)
          .eq("status", "active")
          .then(resolve)
    );

    expect(data).toHaveLength(MAX_ROWS);
  });

  it(`maps every one of ${MEMBERS} active members, with their roles`, async () => {
    mountRoster(memberRows(MEMBERS));

    const roles = await listWorkspaceRoles(WS);

    expect(roles.size).toBe(MEMBERS);
    const expected = new Map(
      memberRows(MEMBERS).map((r) => [String(r.user_id), r.role as Role])
    );
    expect([...roles.keys()].sort()).toEqual([...expected.keys()].sort());
    for (const [user, role] of expected) expect(roles.get(user)).toBe(role);
  });

  /** 🔒 **THE PAYER THE CLIP DROPPED FROM THE RAIL *AND* FROM NAME RESOLUTION.**
   *  `service-usage.ts › resolvePeopleNames` fetches profiles only for ids this
   *  map carries, so one short read cost the row and its name together. */
  it("keeps the payer whose row sorts LAST, as a guest", async () => {
    mountRoster(memberRows(MEMBERS));

    const roles = await listWorkspaceRoles(WS);

    expect(roles.has(DEEP_MEMBER)).toBe(true);
    expect(roles.get(DEEP_MEMBER)).toBe("guest");
  });

  it("walks TWO contiguous pages of the server's own ceiling", async () => {
    const fake = mountRoster(memberRows(MEMBERS));

    await listWorkspaceRoles(WS);

    expect(ranges(fake)).toEqual([
      [0, MAX_ROWS - 1],
      [MAX_ROWS, 2 * MAX_ROWS - 1],
    ]);
  });

  /**
   * 🔒 **NO SELECTED COLUMN IS UNIQUE HERE.** The projection is `user_id, role`
   * and `role` repeats across the whole roster, so only the unselected PRIMARY
   * KEY makes the order total — ORDER BY reaches any column of the relation,
   * which is what keeps the tie-break free (the precedent
   * `repository-token-spend.ts` set with `session_key`).
   */
  it("the roster order is TOTAL — `id`, ordered on and never selected", async () => {
    const seeded = memberRows(MEMBERS);
    const fake = mountRoster(seeded);

    await listWorkspaceRoles(WS);

    expect(orderedColumns(fake)).toEqual(["id"]);
    expect(fake.calls.find((c) => c.op === "select")?.args[0]).toBe(
      "user_id, role"
    );
    expect(tupleCount(seeded, ["id"])).toBe(seeded.length);
    expect(tupleCount(seeded, ["role"])).toBeLessThan(seeded.length);
  });

  it("holds the container fence and the active filter on EVERY page", async () => {
    const fake = mountRoster([
      ...memberRows(1_100),
      // ⚠ Neither may be mapped: another container's roster, and a member who
      // has not accepted yet.
      ...memberRows(200, "other-ws").map((r) => ({
        ...r,
        id: `wm-other-${r.id}`,
        user_id: `other-${r.user_id}`,
      })),
      { id: "wm-pending", workspace_id: WS, user_id: "u-pending", role: "member", status: "pending" },
    ]);

    const roles = await listWorkspaceRoles(WS);

    expect(roles.size).toBe(1_100);
    expect(roles.has("u-pending")).toBe(false);
    const eqs = fake.calls.filter((c) => c.op === "eq").map((c) => c.args);
    expect(eqs).toHaveLength(4);
    expect(eqs.filter((a) => a[0] === "workspace_id")).toHaveLength(2);
    expect(eqs.filter((a) => a[0] === "status" && a[1] === "active")).toHaveLength(2);
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

    await expect(listWorkspaceRoles(WS)).rejects.toMatchObject({ code: "42501" });
  });
});
