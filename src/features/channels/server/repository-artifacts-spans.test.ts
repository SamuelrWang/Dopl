/**
 * 🔒 **THE ARTIFACT CARD'S NUMBERS, OVER A ROOM BIGGER THAN ONE POSTGREST PAGE
 * (F-712).** `repository-artifacts.ts › artifactSpans` used to SELECT the member
 * rows and fold them in JS, and `supabase/config.toml › max_rows` clips a select
 * silently — so every `count` / `firstSeq` / `lastSeq` in a busy room was
 * computed over whatever survived the clip. The fix is server-side aggregation
 * (`channel_artifact_spans`), and these are its pins.
 *
 * ⚠ **THE FAKE APPLIES THE CEILING RATHER THAN RECORDING IT** — the
 * `search/server/_fake-db.ts` discipline, for its reason. A chainable recorder
 * proves a query was WRITTEN; it cannot prove a count is EXACT, because nothing
 * in it ever drops a row. So the fake below clips a table read at the real
 * `max_rows` (read out of `supabase/config.toml`, never hardcoded beside it) and
 * aggregates the RPC over the same rows. The 1,200-member case is then the whole
 * finding, executable: the table read it replaced returns 1,000 rows, and the
 * aggregate returns 1,200.
 *
 * ⚠ **IT ALSO ASSERTS WHAT WAS ASKED, NOT ONLY WHAT CAME BACK** — this
 * directory's discipline. The `p_channel_id` argument is the FENCE (the read it
 * replaced carried `.eq("channel_id", …)`), and a fence is invisible in a return
 * value: an RPC that answered correctly while counting across rooms would pass
 * every assertion about its data.
 *
 * MUTATION-VERIFY: drop `p_channel_id` from the call and the fence case fails;
 * put the JS fold back (read the table, count in TypeScript) and both the
 * >max_rows case and the "touches no table" case fail; drop the `Number(...)`
 * coercion and the bigint case fails.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/shared/supabase/admin", () => ({ supabaseAdmin: vi.fn() }));

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { supabaseAdmin } from "@/shared/supabase/admin";
import { artifactSpans } from "./repository-artifacts";

const CHANNEL = "44444444-4444-4444-8444-444444444444";
const OTHER_CHANNEL = "55555555-5555-4555-8555-555555555555";
const ART = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ART_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

/** ⚠ THE REAL CEILING, READ FROM THE REAL FILE. A literal `1000` here would keep
 *  passing the day somebody moved the config — which is the "fix" F-712 forbids,
 *  and this suite would be the thing that failed to notice. */
const MAX_ROWS = (() => {
  const toml = readFileSync(join(process.cwd(), "supabase", "config.toml"), "utf8");
  const match = /^\s*max_rows\s*=\s*(\d+)\s*$/m.exec(toml);
  if (!match) throw new Error("supabase/config.toml no longer states max_rows");
  return Number(match[1]);
})();

type MessageRow = { channel_id: string; artifact_id: string | null; seq: number };
type Call = { op: string; args: unknown[] };

/**
 * A TINY POSTGREST OVER `channel_messages`, with the two behaviours this finding
 * turns on: a table select is CLIPPED at `max_rows` and says nothing about it,
 * and `rpc()` runs the aggregate the migration defines.
 *
 * ⚠ **THE RPC APPLIES THE FENCE ITSELF**, exactly as the SQL does — filtering on
 * `p_channel_id` and `p_artifact_ids` — so a caller that stopped passing the
 * channel would silently count another room's rows here too, and the fence case
 * would go red rather than green-by-omission.
 * ⚠ **bigint COMES BACK AS A STRING**, which is the wire's own worst case
 * (PostgREST may render `count(*)` / `min()` / `max()` either way).
 */
function fakeDb(rows: MessageRow[], opts: { error?: unknown } = {}) {
  const calls: Call[] = [];
  const builder: Record<string, unknown> = {};
  const rec = (op: string, args: unknown[]) => {
    calls.push({ op, args });
    return builder;
  };
  let selected = rows;
  Object.assign(builder, {
    from: (t: string) => {
      selected = rows;
      return rec("from", [t]);
    },
    select: (c: string) => rec("select", [c]),
    eq: (c: string, v: unknown) => {
      selected = selected.filter((r) => (r as unknown as Record<string, unknown>)[c] === v);
      return rec("eq", [c, v]);
    },
    in: (c: string, v: unknown[]) => {
      const set = new Set(v);
      selected = selected.filter((r) =>
        set.has((r as unknown as Record<string, unknown>)[c])
      );
      return rec("in", [c, v]);
    },
    // ⚠ THE CLIP, AND IT IS SILENT — no error, no marker, just fewer rows.
    then: (resolve: (r: unknown) => void) =>
      resolve({ data: selected.slice(0, MAX_ROWS), error: null }),
  });
  const client = {
    ...builder,
    rpc: (name: string, args: Record<string, unknown>) => {
      calls.push({ op: "rpc", args: [name, args] });
      const spans = new Map<string, { count: number; first: number; last: number }>();
      const ids = new Set((args.p_artifact_ids as string[]) ?? []);
      for (const row of rows) {
        if (row.channel_id !== args.p_channel_id) continue;
        if (row.artifact_id === null || !ids.has(row.artifact_id)) continue;
        const cur = spans.get(row.artifact_id);
        if (cur === undefined) {
          spans.set(row.artifact_id, { count: 1, first: row.seq, last: row.seq });
          continue;
        }
        cur.count += 1;
        cur.first = Math.min(cur.first, row.seq);
        cur.last = Math.max(cur.last, row.seq);
      }
      const data = [...spans.entries()]
        .map(([artifact_id, s]) => ({
          artifact_id,
          count: String(s.count),
          first_seq: String(s.first),
          last_seq: String(s.last),
        }))
        .slice(0, MAX_ROWS);
      return {
        then: (resolve: (r: unknown) => void) =>
          resolve(
            opts.error ? { data: null, error: opts.error } : { data, error: null }
          ),
      };
    },
  };
  vi.mocked(supabaseAdmin).mockReturnValue(client as never);
  return { calls, client };
}

/** `n` members of `artifact`, seqs `from`…`from + n - 1`. */
function members(
  artifact: string,
  n: number,
  from: number,
  channel = CHANNEL
): MessageRow[] {
  return Array.from({ length: n }, (_, i) => ({
    channel_id: channel,
    artifact_id: artifact,
    seq: from + i,
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("artifactSpans — the aggregate is the DATABASE's", () => {
  it("asks `channel_artifact_spans` for it, with the channel and the ids", async () => {
    const { calls } = fakeDb(members(ART, 3, 11));
    await artifactSpans(CHANNEL, [ART]);
    const rpc = calls.find((c) => c.op === "rpc");
    expect(rpc?.args[0]).toBe("channel_artifact_spans");
    expect(rpc?.args[1]).toEqual({
      p_channel_id: CHANNEL,
      p_artifact_ids: [ART],
    });
  });

  /** ⚠ THE FOLD IS GONE, NOT MERELY UNUSED. A repository that still read the
   *  member rows — to check the RPC, to fall back, for any reason — would have
   *  bought back the clipped page this finding is about. */
  it("reads no table at all — `channel_messages` is never touched", async () => {
    const { calls } = fakeDb(members(ART, 3, 11));
    await artifactSpans(CHANNEL, [ART]);
    expect(calls.some((c) => c.op === "from")).toBe(false);
    expect(calls.some((c) => c.op === "select")).toBe(false);
  });

  it("carries count, first and last per artifact", async () => {
    fakeDb([...members(ART, 3, 11), ...members(ART_B, 1, 40)]);
    const spans = await artifactSpans(CHANNEL, [ART, ART_B]);
    expect(spans.get(ART)).toEqual({ count: 3, firstSeq: 11, lastSeq: 13 });
    expect(spans.get(ART_B)).toEqual({ count: 1, firstSeq: 40, lastSeq: 40 });
  });

  /** An artifact that folded nothing has no row in the aggregate, and the map
   *  says so by absence — the shape `service-artifacts-list.ts` filters on. */
  it("omits an artifact with no members rather than inventing a zero span", async () => {
    fakeDb(members(ART, 2, 11));
    const spans = await artifactSpans(CHANNEL, [ART, ART_B]);
    expect(spans.has(ART_B)).toBe(false);
  });

  /** ⚠ `count(*)`, `min()` and `max()` are `bigint`. A string that renders
   *  plausibly and compares wrongly is the failure this coercion prevents. */
  it("coerces the bigint columns — never hands a string on as a number", async () => {
    fakeDb(members(ART, 2, 11));
    const span = (await artifactSpans(CHANNEL, [ART])).get(ART);
    expect(typeof span?.count).toBe("number");
    expect(typeof span?.firstSeq).toBe("number");
    expect(typeof span?.lastSeq).toBe("number");
  });

  it("no ids, no round trip", async () => {
    const { calls } = fakeDb(members(ART, 3, 11));
    expect((await artifactSpans(CHANNEL, [])).size).toBe(0);
    expect(calls).toHaveLength(0);
  });

  /** ⚠ AN ERROR THROWS. `PGRST202` — the migration is not applied here — is NOT
   *  degraded to an empty map: the card would then read "no members" for an
   *  artifact that has them, which is the silent wrong answer one level over. */
  it("throws what the database answered", async () => {
    fakeDb(members(ART, 3, 11), { error: { code: "PGRST202", message: "no function" } });
    await expect(artifactSpans(CHANNEL, [ART])).rejects.toMatchObject({
      code: "PGRST202",
    });
  });
});

describe("artifactSpans — past the PostgREST ceiling (F-712)", () => {
  const OVER = MAX_ROWS + 200;

  it(`counts all ${MAX_ROWS + 200} members exactly — the number the old fold could not reach`, async () => {
    fakeDb(members(ART, OVER, 1));
    const span = (await artifactSpans(CHANNEL, [ART])).get(ART);
    expect(span?.count).toBe(OVER);
    expect(span?.firstSeq).toBe(1);
    expect(span?.lastSeq).toBe(OVER);
  });

  /** 🔒 **THE CONTROL, AND WITHOUT IT THE CASE ABOVE PROVES NOTHING.** It shows
   *  the fake really does clip a table read at `max_rows` — so the old path
   *  would have answered `count: 1000, lastSeq: 1000` over the same rows, which
   *  is the wrong-answer half of the finding rather than a missing-rows half. */
  it("⚠ the table read it replaced is still clipped, silently, by the same fake", async () => {
    const rows = members(ART, OVER, 1);
    const { client } = fakeDb(rows);
    const { data, error } = (await (
      client as unknown as {
        from: (t: string) => {
          select: (c: string) => {
            eq: (c: string, v: unknown) => {
              in: (c: string, v: unknown[]) => PromiseLike<{
                data: MessageRow[];
                error: unknown;
              }>;
            };
          };
        };
      }
    )
      .from("channel_messages")
      .select("artifact_id, seq")
      .eq("channel_id", CHANNEL)
      .in("artifact_id", [ART])) as { data: MessageRow[]; error: unknown };
    expect(error).toBeNull();
    expect(data).toHaveLength(MAX_ROWS);
    expect(data.at(-1)?.seq).toBe(MAX_ROWS);
  });

  /** The span of a room where several artifacts are each over the ceiling: the
   *  cap now applies to ARTIFACTS, a set the caller already bounds. */
  it("stays exact for two artifacts that each exceed the ceiling on their own", async () => {
    fakeDb([...members(ART, OVER, 1), ...members(ART_B, OVER, 10_000)]);
    const spans = await artifactSpans(CHANNEL, [ART, ART_B]);
    expect(spans.get(ART)?.count).toBe(OVER);
    expect(spans.get(ART_B)?.count).toBe(OVER);
    expect(spans.get(ART_B)?.firstSeq).toBe(10_000);
  });
});

describe("artifactSpans — the fence", () => {
  /** 🔒 **THE CHANNEL PREDICATE IS THE AUTHORIZATION, NOT A NARROWING** — the
   *  sentence `findArtifactByChannelAndId` carries. A member row that somehow
   *  carried a foreign artifact id must not be counted out of another room, and
   *  that is why the RPC takes the channel rather than trusting the ids. */
  it("counts only rows in the named channel, even for the same artifact id", async () => {
    fakeDb([...members(ART, 3, 11), ...members(ART, 500, 1, OTHER_CHANNEL)]);
    expect((await artifactSpans(CHANNEL, [ART])).get(ART)?.count).toBe(3);
  });

  it("an artifact whose members all live in another channel is absent", async () => {
    fakeDb(members(ART, 5, 1, OTHER_CHANNEL));
    expect((await artifactSpans(CHANNEL, [ART])).size).toBe(0);
  });
});
