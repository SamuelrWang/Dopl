/**
 * 🔒 **THE ACCOUNT-WIDE READS' CEILINGS, MEASURED AGAINST THE SERVER'S RATHER
 * THAN THE ASK (Samuel #2935, the `max_rows` sweep).**
 *
 * `repository-account.ts` computed `truncated = rows.length >= limit`.
 * `supabase/config.toml › max_rows` clips every PostgREST select server-side at
 * 1,000 and raises nothing, so **any** read here asking for more than that
 * computed `1000 >= <ask>` = **false** and reported itself COMPLETE — a floor
 * claiming to be exhaustive. Two distinct findings:
 *
 *  1. 🔒 **`ACCOUNT_TALLY_LIMIT` WAS THE LITERAL `1_000`, WHICH IS THE SAME
 *     NUMBER AS THE CAP — so the unread tally was honest TODAY BY COINCIDENCE.**
 *     Its own docblock invites the raise ("cheap per row and the ceiling can be
 *     high"); the moment anyone took it, the server would have kept clipping at
 *     1,000 while every per-channel unread count rendered as EXACT. It is now
 *     DERIVED from `POSTGREST_MAX_ROWS`, so the coincidence is a statement.
 *  2. 🔒 **`listMyChannelMemberships` TAKES ITS `limit` FROM A CALLER**, and the
 *     old comparison was already wrong for any value above the cap. That is the
 *     live lever in this file, and it is what the honest-marker cases below
 *     drive — no constant has to be edited to make the defect executable.
 *
 * ⚠ **WHAT IS DELIBERATELY NOT CHANGED: the tally still returns a FLOOR.** Past
 * the cap the counts are incomplete and `service-account.ts` renders
 * `truncated.unread`; this suite pins that it SAYS SO, which is the §9 contract.
 * Making it exact needs a different SHAPE (a `count` per channel), not a bigger
 * number — the thing the old literal hid.
 *
 * ⚠ **THE FAKE APPLIES THE CEILING RATHER THAN RECORDING IT** (`shared/testing/
 * postgrest-cap.ts`): a recorder proves a query was WRITTEN and can never prove a
 * marker is HONEST, because nothing in it ever drops a row. `MAX_ROWS` is read
 * out of `supabase/config.toml`, never written beside it.
 *
 * MUTATION-VERIFY (each reverted alone turns the named case red):
 *  - put `truncated: rows.length >= limit` back in place of `clippedAt` → both
 *    "above the cap" cases fail (they go green-by-lying).
 *  - restate `ACCOUNT_TALLY_LIMIT = 1_000` as a literal → "derived, not
 *    restated" still passes on VALUE, which is why the honest-marker cases carry
 *    the actual protection and are listed first.
 *  - drop `.in("channel_id", …)` or the `or(...)` author string → the fence cases
 *    fail.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/shared/supabase/admin", () => ({ supabaseAdmin: vi.fn() }));
vi.mock("./repository-sessions", () => ({ sessionRowsWhere: vi.fn() }));

import { supabaseAdmin } from "@/shared/supabase/admin";
import { MAX_ROWS, fakePostgrest, type Row } from "@/shared/testing/postgrest-cap";
import {
  ACCOUNT_ADDRESSED_LIMIT,
  ACCOUNT_CHANNEL_LIMIT,
  ACCOUNT_TALLY_LIMIT,
  listAddressedToMe,
  listMyChannelMemberships,
  tallyAccountMessagesAfter,
} from "./repository-account";

const ME = "22222222-3333-4444-8555-666666666666";
const PEER = "99999999-8888-4777-8666-555555555555";
const WS_A = "11111111-2222-4333-8444-555555555555";
const WS_B = "aaaaaaaa-2222-4333-8444-555555555555";
const CH_A = "33333333-4444-4555-8666-777777777777";
const CH_B = "44444444-5555-4666-8777-888888888888";

/** ⚠ Past the cap, not past the ask: the whole point is that the SERVER stops
 *  first, whatever the caller wrote. */
const OVER_CAP = MAX_ROWS + 200;

/** `n` messages in `channel`, seqs `from`…, authored by `author`. */
function messages(
  n: number,
  from: number,
  channel = CH_A,
  author: string | null = PEER
): Row[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `m-${channel}-${from + i}`,
    channel_id: channel,
    seq: from + i,
    author_user_id: author,
    metadata: { to_user_id: ME },
    // ⚠ THE JSON PATH AS A LITERAL COLUMN NAME, because the fake records
    // PostgREST's grammar rather than parsing it (`postgrest-cap.ts`'s header) —
    // a fake that parsed `metadata->>to_user_id` would be asserting its own
    // parser. The nested object above is what the real row looks like.
    "metadata->>to_user_id": ME,
  }));
}

/** `n` memberships for `user`, one per synthetic channel. */
function memberships(n: number, user = ME, workspace = WS_A): Row[] {
  return Array.from({ length: n }, (_, i) => ({
    user_id: user,
    channel_id: `c-${workspace}-${String(i).padStart(6, "0")}`,
    workspace_id: workspace,
  }));
}

function mount(tables: Record<string, readonly Row[]>) {
  const fake = fakePostgrest(tables);
  vi.mocked(supabaseAdmin).mockReturnValue(fake.client as never);
  return fake;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("the honest marker — a read above the cap says it was clipped", () => {
  /** 🔒 **THE FINDING, EXECUTABLE, THROUGH THE ONE CALLER-SUPPLIED LIMIT IN THIS
   *  FILE.** Ask 5,000, receive the server's 1,000: the old comparison computed
   *  `1000 >= 5000` = false and handed the caller a FLOOR labelled COMPLETE, so
   *  `listAccountChannelRefs` would have reported a whole account while naming a
   *  fifth of its rooms — and every downstream read is fenced by exactly that id
   *  set, so the missing rooms vanish from the page with nothing saying why. */
  it(`reports truncated TRUE at ${MAX_ROWS} rows for an ask of 5,000`, async () => {
    mount({ channel_members: memberships(OVER_CAP) });
    const out = await listMyChannelMemberships(ME, null, 5_000);
    expect(out.rows).toHaveLength(MAX_ROWS);
    expect(out.truncated).toBe(true);
  });

  /** ⚠ THE CONTROL: the same statement, asking UNDER the cap, must still answer
   *  the ask and still report honestly — otherwise the fix above is just a
   *  constant `true`. */
  it("still reports truncated FALSE for a complete read under the cap", async () => {
    mount({ channel_members: memberships(10) });
    const out = await listMyChannelMemberships(ME, null, ACCOUNT_CHANNEL_LIMIT);
    expect(out.rows).toHaveLength(10);
    expect(out.truncated).toBe(false);
  });

  /** ⚠ **AT the ceiling counts as clipped** (§9) — at is indistinguishable from
   *  over. Unchanged by this fix, and pinned so it stays unchanged. */
  it("AT a sub-cap ceiling is still clipped", async () => {
    mount({ channel_messages: messages(ACCOUNT_ADDRESSED_LIMIT, 1) });
    const out = await listAddressedToMe([CH_A], ME);
    expect(out.rows).toHaveLength(ACCOUNT_ADDRESSED_LIMIT);
    expect(out.truncated).toBe(true);
  });

  it("the B1 workspace lock still narrows the PROOF itself", async () => {
    const fake = mount({
      channel_members: [
        ...memberships(3, ME, WS_A),
        ...memberships(4, ME, WS_B),
      ],
    });
    const out = await listMyChannelMemberships(ME, WS_B, ACCOUNT_CHANNEL_LIMIT);
    expect(out.rows).toHaveLength(4);
    expect(out.rows.every((r) => r.workspace_id === WS_B)).toBe(true);
    const eqs = fake.calls.filter((c) => c.op === "eq").map((c) => c.args);
    expect(eqs).toEqual([
      ["user_id", ME],
      ["workspace_id", WS_B],
    ]);
  });
});

describe("the unread tally — a FLOOR that says so, at the real ceiling", () => {
  /** 🔒 **DERIVED, NOT RESTATED.** The literal and the cap are the same number
   *  today, so this equality is a tripwire for the day they stop being: raising
   *  `max_rows` must move this ceiling with it, and nothing may set it above the
   *  cap without changing the read's SHAPE. */
  it("ACCOUNT_TALLY_LIMIT is the PostgREST ceiling, read from config.toml", () => {
    expect(ACCOUNT_TALLY_LIMIT).toBe(MAX_ROWS);
  });

  it(`clips at ${MAX_ROWS} over ${OVER_CAP} unread and reports truncated TRUE`, async () => {
    mount({ channel_messages: messages(OVER_CAP, 1) });
    const out = await tallyAccountMessagesAfter([CH_A], 0, ME);
    expect(out.rows).toHaveLength(MAX_ROWS);
    // 🔒 The half that must never go quiet: `service-account.ts` renders this as
    // `truncated.unread`, and every per-channel count is a floor beneath it.
    expect(out.truncated).toBe(true);
  });

  /** ⚠ The per-channel fold (`service-account.ts › countFor`) is over whatever
   *  survived, so the busiest room can crowd a quiet one off the page entirely.
   *  That is the cost the clip report exists to disclose — pinned, so nobody
   *  reads the floor as exact. */
  it("a quiet room can be crowded out of a clipped tally — which is why it reports", async () => {
    mount({
      channel_messages: [
        ...messages(OVER_CAP, 1, CH_A),
        ...messages(5, 90_000, CH_B),
      ],
    });
    const out = await tallyAccountMessagesAfter([CH_A, CH_B], 0, ME);
    expect(out.rows.filter((r) => r.channel_id === CH_B)).toHaveLength(0);
    expect(out.truncated).toBe(true);
  });

  it("a tally inside the ceiling is exact and complete", async () => {
    mount({
      channel_messages: [...messages(7, 1, CH_A), ...messages(3, 500, CH_B)],
    });
    const out = await tallyAccountMessagesAfter([CH_A, CH_B], 0, ME);
    expect(out.rows).toHaveLength(10);
    expect(out.truncated).toBe(false);
  });
});

describe("the tally's fence and shape are untouched", () => {
  /** 🔒 **THE CHANNEL ID SET IS THE AUTHORIZATION, NOT A NARROWING** — it comes
   *  only from the membership proof, so a room the caller is not in is never
   *  NAMED rather than filtered afterwards. */
  it("names only the channels it was handed, even past the ceiling", async () => {
    const fake = mount({
      channel_messages: [
        ...messages(OVER_CAP, 1, CH_A),
        ...messages(400, 1, CH_B),
      ],
    });
    const out = await tallyAccountMessagesAfter([CH_B], 0, ME);
    expect(out.rows.every((r) => r.channel_id === CH_B)).toBe(true);
    expect(fake.calls.find((c) => c.op === "in")?.args).toEqual([
      "channel_id",
      [CH_B],
    ]);
  });

  /** ⚠ `NULL <> x` is NULL, not true: a bare `neq` would drop every SYSTEM row.
   *  A deliberate third copy of this string, pinned here as well as in
   *  `repository-account.test.ts` because this file now routes through a shared
   *  clip helper and that is exactly the kind of edit that loses a clause. */
  it("keeps the author-exclusion `or` string and the cursor", async () => {
    const fake = mount({ channel_messages: messages(3, 1) });
    await tallyAccountMessagesAfter([CH_A], 4, ME);
    expect(fake.calls.find((c) => c.op === "or")?.args[0]).toBe(
      `author_user_id.is.null,author_user_id.neq.${ME}`
    );
    expect(fake.calls.find((c) => c.op === "gt")?.args).toEqual(["seq", 4]);
  });

  /** ⚠ TWO COLUMNS AND NOTHING ELSE — hauling bodies to count them is the
   *  payload §9 forbids, and it is the reason this ceiling can sit on the cap. */
  it("still reads `channel_id, seq` and asks the derived ceiling", async () => {
    const fake = mount({ channel_messages: messages(3, 1) });
    await tallyAccountMessagesAfter([CH_A], 0, ME);
    expect(fake.calls.find((c) => c.op === "select")?.args[0]).toBe(
      "channel_id, seq"
    );
    expect(fake.calls.find((c) => c.op === "limit")?.args).toEqual([MAX_ROWS]);
  });

  it("no channel ids, no query at all", async () => {
    const fake = mount({ channel_messages: messages(3, 1) });
    expect(await tallyAccountMessagesAfter([], 0, ME)).toEqual({
      rows: [],
      truncated: false,
    });
    expect(fake.calls).toHaveLength(0);
  });
});
