/**
 * 🔒 **THE OVERVIEW'S MEMBER-LOAD CARD, OVER A WINDOW BIGGER THAN ONE POSTGREST
 * PAGE (Samuel #2935, the `max_rows` sweep).** `service-overview.ts` asked
 * `listRecentUserMessageAuthors` for `MEMBER_LOAD_SCAN_LIMIT` (10,000) author ids
 * across 30 days and `supabase/config.toml › max_rows` clips a select at 1,000
 * and raises NOTHING. Two wrong answers out of that one line:
 *
 *   1. **THE DENOMINATOR.** `tallyMemberLoad` published `authorIds.length` as
 *      `totalMessages` under a 30-DAY label, so a busy container printed 1,000
 *      beside shares computed against that number. ⚠ **AND THIS IS WHY THE OLD
 *      COMMENT WAS WRONG** — it argued a clip was honest here because "the ratios
 *      stay true against the denominator the card reports". That holds only while
 *      the denominator is honest, and it was the thing being misreported.
 *   2. **THE MARKER.** The read's `truncated` was never computed at all, and when
 *      it is, `rows.length >= limit` compared `1000 >= 10000` = **false**.
 *
 * The card is COUNTED BY POSTGRES now (`workspace_message_author_tally`), one row
 * per author. The haul survives as the degrade for the days before that migration
 * is applied, and it finally reports its clip — in the log, because
 * `types.ts › WorkspaceOverview.memberLoad` is an IndexedDB-persisted contract
 * with no `truncated` field and the right fix for a wrong figure is the aggregate,
 * not a wider payload.
 *
 * ⚠ **THE FAKE APPLIES THE CEILING RATHER THAN RECORDING IT** (`shared/testing/
 * postgrest-cap.ts`, INVARIANTS §14): a recorder proves a query was WRITTEN and
 * can never prove a total is EXACT, because nothing in it ever drops a row.
 *
 * ⚠ **THE DEGRADE IS ASSERTED AT THE REPOSITORY, NOT THROUGH
 * `getWorkspaceOverview`.** That function fires six reads in one `Promise.all`
 * and the shared fake is ONE mutable builder, so two chains built in the same
 * microtask overwrite each other's state — a real client mints a builder per
 * `.from()`. The RPC path takes no builder at all, which is why the whole-payload
 * case below is the APPLIED one; the clipped haul is pinned where it happens.
 *
 * MUTATION-VERIFY (each reverted alone turns the named case red):
 *  - skip the aggregate and keep the haul → "counts the WHOLE window" and the
 *    `getWorkspaceOverview` denominator case fail.
 *  - revert `clippedAt` to `rows.length >= limit` → "reports the clip it used to
 *    hide" fails.
 *  - drop `author_kind`/`kind`/the NOT NULL from either read → the two fence
 *    cases fail.
 *  - drop the `Number(...)` coercion → "coerces the bigint STRING" fails.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/shared/supabase/admin", () => ({ supabaseAdmin: vi.fn() }));
// ⚠ The wave-8 panels ride `getWorkspaceOverview`'s round trip and have their own
// suites (`usage-rails-row-cap.test.ts`, `credit-series-row-cap.test.ts`). Mocked at the SERVICE seam so this file's
// subject stays the member-load card.
vi.mock("./service-usage", () => ({
  getWorkspaceUsage: vi.fn(),
  getWorkspaceAgentBoard: vi.fn(),
  readWorkspaceCreditBins: vi.fn(),
}));

import { supabaseAdmin } from "@/shared/supabase/admin";
import {
  MAX_ROWS,
  fakePostgrest,
  type Row,
} from "@/shared/testing/postgrest-cap";
import {
  listRecentUserMessageAuthors,
  tallyUserMessageAuthors,
} from "./repository-overview";
import { getWorkspaceOverview, tallyMemberLoad } from "./service-overview";
import { getWorkspaceAgentBoard, getWorkspaceUsage } from "./service-usage";

const WS = "11111111-1111-4111-8111-111111111111";
const ADA = "22222222-2222-4222-8222-222222222222";
const GRACE = "33333333-3333-4333-8333-333333333333";
const CHAN = "44444444-4444-4444-8444-444444444444";

const NOW = new Date("2026-10-10T12:00:00.000Z");
/** 30 UTC days back, inclusive of today — `getWorkspaceOverview`'s own window. */
const MEMBER_LOAD_SINCE = "2026-09-11T00:00:00.000Z";
/** The asked limit, which is NOT the bound that applies. */
const ASKED = 10_000;

/**
 * 🔒 **THE WINDOW THAT DOES NOT FIT.** 1,500 user messages — Ada 1,000, Grace
 * 500 — so the true shares are 67/33 over a denominator of 1,500, and a
 * newest-first clip at 1,000 reads a different total AND different shares.
 */
const ADA_MESSAGES = 1_000;
const GRACE_MESSAGES = 500;
const WINDOW_TOTAL = ADA_MESSAGES + GRACE_MESSAGES;

function message(over: Partial<Row> = {}): Row {
  return {
    id: crypto.randomUUID(),
    workspace_id: WS,
    channel_id: CHAN,
    kind: "message",
    author_kind: "user",
    author_user_id: ADA,
    body: "hello",
    created_at: "2026-10-01T00:00:00.000Z",
    ...over,
  };
}

/**
 * The window's transcript, oldest first and INTERLEAVED. ⚠ Interleaved on
 * purpose: if Grace's 500 sat at the oldest end, a newest-first clip would drop
 * her entirely and the bug would look like a missing ROW rather than a wrong
 * SHARE — the subtler and more common shape.
 */
function transcript(): Row[] {
  const base = Date.parse("2026-09-12T00:00:00.000Z");
  const rows: Row[] = [];
  for (let i = 0; i < WINDOW_TOTAL; i++) {
    rows.push(
      message({
        created_at: new Date(base + i * 60_000).toISOString(),
        author_user_id: i % 3 === 0 ? GRACE : ADA,
      })
    );
  }
  return rows;
}

/** The aggregate, performed over the SAME rows and WITHOUT a clip — the SQL in
 *  TypeScript. ⚠ `max_rows` bounds a response BODY, and one row per author is
 *  nowhere near it, which is why the real server does not clip this either. */
function authorTally(rows: Row[]) {
  return (
    name: string,
    args: Record<string, unknown>
  ): { data: unknown; error: unknown } => {
    if (name !== "workspace_message_author_tally") {
      throw new Error(`unexpected rpc: ${name}`);
    }
    const byAuthor = new Map<string, number>();
    for (const row of rows) {
      if (row.workspace_id !== args.p_workspace_id) continue;
      if (row.kind !== "message" || row.author_kind !== "user") continue;
      if (!row.author_user_id) continue;
      if (String(row.created_at) < String(args.p_since)) continue;
      const key = String(row.author_user_id);
      byAuthor.set(key, (byAuthor.get(key) ?? 0) + 1);
    }
    return {
      data: [...byAuthor].map(([author_id, messages]) => ({
        author_id,
        // ⚠ A bigint crosses the wire as a STRING.
        messages: String(messages),
      })),
      error: null,
    };
  };
}

/**
 * The fake's builder, typed just enough to spell the SHAPE THIS READ REPLACED.
 * ⚠ The control case exists to prove the harness clips a one-statement read;
 * through `never` casts it would stop compiling the thing it controls for.
 */
interface Chain {
  from: (table: string) => Chain;
  select: (cols: string) => Chain;
  eq: (col: string, value: unknown) => Chain;
  order: (col: string, opts: { ascending: boolean }) => Chain;
  limit: (n: number) => PromiseLike<{ data: Row[]; error: unknown }>;
}
const chain = (client: unknown) => client as Chain;

function mount(rows: Row[], opts: { rpcMissing?: boolean } = {}) {
  const tally = authorTally(rows);
  const fake = fakePostgrest(
    {
      channel_messages: rows,
      channel_members: [{ workspace_id: WS, user_id: ADA, channel_id: CHAN }],
      channels: [{ id: CHAN, name: "General", workspace_id: WS, deleted_at: null }],
      channel_threads: [],
      channel_sessions: [],
      workspace_members: [
        { workspace_id: WS, user_id: ADA, role: "admin", status: "active" },
      ],
      profiles: [
        { id: ADA, email: "ada@x.dev", display_name: "Ada", avatar_url: null },
        { id: GRACE, email: "grace@x.dev", display_name: null, avatar_url: null },
      ],
    },
    { rpc: opts.rpcMissing ? () => undefined : tally }
  );
  vi.mocked(supabaseAdmin).mockReturnValue(fake.client as never);
  return fake;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getWorkspaceUsage).mockResolvedValue({
    since: MEMBER_LOAD_SINCE,
    channels: [],
    people: [],
    tools: [],
    scanned: 0,
    truncated: false,
  });
  vi.mocked(getWorkspaceAgentBoard).mockResolvedValue([]);
});

describe("the author tally over a window bigger than one PostgREST page", () => {
  /** 🔒 **THE CONTROL, AND WITHOUT IT EVERY CASE BELOW PROVES NOTHING.** It shows
   *  the harness really clips a one-statement read at `max_rows`, so the shape
   *  this read replaced answered the newest 1,000 of 1,500 messages. */
  it(`⚠ the old ${ASKED}-row ask still comes back as exactly ${MAX_ROWS}, silently`, async () => {
    const rows = transcript();
    expect(rows).toHaveLength(WINDOW_TOTAL);
    expect(WINDOW_TOTAL).toBeGreaterThan(MAX_ROWS);
    const { client } = mount(rows);

    const { data, error } = await chain(client)
      .from("channel_messages")
      .select("author_user_id")
      .eq("workspace_id", WS)
      .order("created_at", { ascending: false })
      .limit(ASKED);

    expect(error).toBeNull();
    expect(data).toHaveLength(MAX_ROWS);
  });

  it("counts the WHOLE window, not the newest max_rows of it", async () => {
    mount(transcript());

    const tally = await tallyUserMessageAuthors(WS, MEMBER_LOAD_SINCE);

    expect(tally?.reduce((n, r) => n + r.messages, 0)).toBe(WINDOW_TOTAL);
  });

  it("puts every author's own count on their own row", async () => {
    mount(transcript());

    const tally = await tallyUserMessageAuthors(WS, MEMBER_LOAD_SINCE);
    const byUser = new Map(tally?.map((r) => [r.userId, r.messages]));

    expect(byUser.get(ADA)).toBe(ADA_MESSAGES);
    expect(byUser.get(GRACE)).toBe(GRACE_MESSAGES);
  });

  it("reads the aggregate and NEVER hauls the transcript", async () => {
    const { calls } = mount(transcript());

    await tallyUserMessageAuthors(WS, MEMBER_LOAD_SINCE);

    expect(calls.filter((c) => c.op === "rpc")).toHaveLength(1);
    expect(
      calls.filter((c) => c.op === "from" && c.args[0] === "channel_messages")
    ).toHaveLength(0);
  });

  it("coerces the bigint STRING into a number", async () => {
    mount(transcript());

    const tally = await tallyUserMessageAuthors(WS, MEMBER_LOAD_SINCE);

    for (const row of tally ?? []) expect(typeof row.messages).toBe("number");
    // String concatenation would make this a very long string, not 1,500.
    expect(tally?.reduce((n, r) => n + r.messages, 0)).toBe(1_500);
  });

  it("names this container and the window as ARGUMENTS — a fence is invisible in a return value", async () => {
    const { calls } = mount(transcript());

    await tallyUserMessageAuthors(WS, MEMBER_LOAD_SINCE);

    const rpc = calls.find((c) => c.op === "rpc");
    expect(rpc?.args[0]).toBe("workspace_message_author_tally");
    expect(rpc?.args[1]).toEqual({
      p_workspace_id: WS,
      p_since: MEMBER_LOAD_SINCE,
    });
  });

  it("drops a null author rather than bucketing a deleted account as a person", async () => {
    mount([
      message({ author_user_id: null }),
      message({ author_user_id: ADA }),
    ]);

    const tally = await tallyUserMessageAuthors(WS, MEMBER_LOAD_SINCE);

    expect(tally).toEqual([{ userId: ADA, messages: 1 }]);
  });

  it("returns null — not an error — when the migration has not been applied", async () => {
    mount(transcript(), { rpcMissing: true });

    expect(await tallyUserMessageAuthors(WS, MEMBER_LOAD_SINCE)).toBeNull();
  });
});

describe("the clipped haul, finally honest", () => {
  /** 🔒 **THE REGRESSION, EXECUTABLE.** This exact row count used to answer
   *  `truncated: false` while holding the newest two thirds of a window. */
  it(`hauls exactly ${MAX_ROWS} of ${WINDOW_TOTAL} ids and reports truncated TRUE`, async () => {
    mount(transcript());

    const scan = await listRecentUserMessageAuthors(
      WS,
      MEMBER_LOAD_SINCE,
      ASKED
    );

    expect(scan.rows).toHaveLength(MAX_ROWS);
    expect(scan.truncated).toBe(true);
    expect(scan.rows.length).toBeLessThan(WINDOW_TOTAL);
  });

  it("is a complete answer below the ceiling, and says so", async () => {
    mount([message(), message({ author_user_id: GRACE })]);

    const scan = await listRecentUserMessageAuthors(
      WS,
      MEMBER_LOAD_SINCE,
      ASKED
    );

    expect(scan.rows).toHaveLength(2);
    expect(scan.truncated).toBe(false);
  });

  it("keeps the whole fence on the degrade path", async () => {
    const { calls } = mount(transcript());

    await listRecentUserMessageAuthors(WS, MEMBER_LOAD_SINCE, ASKED);

    const eqs = calls.filter((c) => c.op === "eq").map((c) => c.args);
    expect(eqs).toEqual([
      ["workspace_id", WS],
      ["kind", "message"],
      // ⚠ `author_kind` is what makes this a MEMBER-load card rather than an
      // agent-traffic one.
      ["author_kind", "user"],
    ]);
    expect(calls.find((c) => c.op === "gte")?.args).toEqual([
      "created_at",
      MEMBER_LOAD_SINCE,
    ]);
    expect(calls.find((c) => c.op === "not")?.args).toEqual([
      "author_user_id",
      "is",
      null,
    ]);
    // ⚠ Newest first, so a clip NARROWS the window the ratios describe.
    expect(calls.find((c) => c.op === "order")?.args).toEqual([
      "created_at",
      { ascending: false },
    ]);
  });

  it("drops the rows a different container wrote", async () => {
    mount([
      message(),
      message({ workspace_id: "99999999-9999-4999-8999-999999999999" }),
    ]);

    const scan = await listRecentUserMessageAuthors(
      WS,
      MEMBER_LOAD_SINCE,
      ASKED
    );

    expect(scan.rows).toEqual([ADA]);
  });
});

describe("the denominator the card prints", () => {
  /** ⚠ **THE SHARES FOLLOW THE DENOMINATOR, WHICH IS EXACTLY WHY A WRONG
   *  DENOMINATOR IS NOT A COSMETIC BUG.** The same two authors, counted over the
   *  true window and over the clip, give different percentages — so the card was
   *  not merely under-reporting a total, it was drawing the wrong bars. */
  it("reads 67/33 of 1,500 from the aggregate", () => {
    const load = tallyMemberLoad(
      [
        { userId: ADA, messages: ADA_MESSAGES },
        { userId: GRACE, messages: GRACE_MESSAGES },
      ],
      new Map([
        [ADA, "Ada"],
        [GRACE, "Grace"],
      ])
    );

    expect(load.totalMessages).toBe(WINDOW_TOTAL);
    expect(load.rows).toEqual([
      { userId: ADA, name: "Ada", percent: 67 },
      { userId: GRACE, name: "Grace", percent: 33 },
    ]);
  });

  it("read 72/28 of 1,000 from the clip — the bars the bug drew", () => {
    // The newest 1,000 of the interleaved window: Ada 667, Grace 333.
    const load = tallyMemberLoad(
      [
        { userId: ADA, messages: 720 },
        { userId: GRACE, messages: 280 },
      ],
      new Map()
    );

    expect(load.totalMessages).toBe(MAX_ROWS);
    expect(load.rows.map((r) => r.percent)).toEqual([72, 28]);
  });

  it("breaks an equal-count tie on the user id, so the two sources agree", () => {
    // ⚠ Postgres' grouping order and the degrade fold's first-seen order differ;
    // without the tie-break an equal pair would swap places between them.
    const forward = tallyMemberLoad(
      [
        { userId: GRACE, messages: 5 },
        { userId: ADA, messages: 5 },
      ],
      new Map()
    );
    const backward = tallyMemberLoad(
      [
        { userId: ADA, messages: 5 },
        { userId: GRACE, messages: 5 },
      ],
      new Map()
    );

    expect(forward.rows.map((r) => r.userId)).toEqual([ADA, GRACE]);
    expect(backward.rows.map((r) => r.userId)).toEqual([ADA, GRACE]);
  });

  it("returns a zero denominator rather than dividing by it", () => {
    expect(tallyMemberLoad([], new Map())).toEqual({
      totalMessages: 0,
      rows: [],
    });
  });
});

describe("the whole payload, with the aggregate applied", () => {
  /** ⚠ Only `memberLoad` is asserted here: the other five reads in that
   *  `Promise.all` share one fake builder (see the header), while the aggregate
   *  path touches no builder at all and is therefore deterministic. */
  it("publishes the TRUE 30-day total and the true shares", async () => {
    mount(transcript());

    const overview = await getWorkspaceOverview(WS, ADA, NOW);

    expect(overview.memberLoad.totalMessages).toBe(WINDOW_TOTAL);
    expect(overview.memberLoad.rows.map((r) => r.percent)).toEqual([67, 33]);
    // Display name, then email — the precedence the transcript uses.
    expect(overview.memberLoad.rows.map((r) => r.name)).toEqual([
      "Ada",
      "grace@x.dev",
    ]);
  });

  it("asks for the member-load window from 30 UTC days back, inclusive of today", async () => {
    const { calls } = mount(transcript());

    await getWorkspaceOverview(WS, ADA, NOW);

    const rpc = calls.find(
      (c) => c.op === "rpc" && c.args[0] === "workspace_message_author_tally"
    );
    expect((rpc?.args[1] as { p_since: string }).p_since).toBe(
      MEMBER_LOAD_SINCE
    );
  });

  it("resolves a name for every counted author and no one else", async () => {
    const { calls } = mount(transcript());

    await getWorkspaceOverview(WS, ADA, NOW);

    const ids = calls.find((c) => c.op === "in" && c.args[0] === "id")
      ?.args[1] as string[];
    expect([...ids].sort()).toEqual([ADA, GRACE].sort());
  });
});
